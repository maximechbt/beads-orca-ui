// Runs `bd` in the focused workspace's folder; panels cannot run processes, the worker can.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { appendFile, mkdir, open, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { OrcaWorkerApi } from 'orca/worker'
import { AGENTS, availableAgents } from './agents'
import { closedSince, STATUSES, TYPES } from './model'
import './protocol'

const run = promisify(execFile)

/** Orca refuses answers holding `undefined`; a JSON round trip drops those keys. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))

const pick = <T extends object, K extends keyof T>(row: T, keys: K[]) =>
  Object.fromEntries(keys.map((k) => [k, row[k]])) as Pick<T, K>

type Workspace = { id: string; kind: string; name: string; path: string; branch: string | null; hostId: string | null }

async function focused(orca: OrcaWorkerApi): Promise<{ ws: Workspace | null; all: Workspace[] }> {
  const ctx = await orca.host.call('workspace.readContext')
  if (!ctx) return { ws: null, all: [] }
  const { workspaces } = await orca.host.call('workspace.list')
  // readContext has no path: match on branch, and on name when several repos share a branch.
  const sameBranch = workspaces.filter((w) => w.branch === ctx.branch)
  return { ws: sameBranch.find((w) => w.name === ctx.displayName) ?? sameBranch[0] ?? null, all: workspaces }
}

/**
 * bd runs one at a time per folder: two bd processes on one database slow each other down (measured: 1.0 s in parallel,
 * 0.7 s in turn). Another workspace has its own turn, so a switch never waits behind the last one's calls or its fetch.
 */
const bdTurn = new Map<string, Promise<unknown>>()

async function exec(cwd: string, file: string, args: string[]): Promise<string> {
  const go = async () => (await run(file, args, { cwd, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })).stdout
  if (file !== 'bd') return go()
  const turn = (bdTurn.get(cwd) ?? Promise.resolve()).then(go, go)
  bdTurn.set(cwd, turn.catch(() => {}))
  return turn
}

/** `bd ready` and the epics' progress per workspace, kept while the list they were read with is unchanged; each costs a whole bd process. */
const readyFor = new Map<string, { list: string; ready: string[]; epics: Record<string, EpicProgress>; closed: number; commit?: string; ahead?: number; at: number }>()
/** The closed window per workspace, read again only when the open list changes (a close or a reopen changes it) or after READY_TTL. */
/** Each workspace's repository: git's common directory, the same for every worktree. Outside git, the folder itself. */
const projectFor = new Map<string, string>()
async function projectOf(cwd: string): Promise<string> {
  const known = projectFor.get(cwd)
  if (known) return known
  const dir = (await exec(cwd, 'git', ['rev-parse', '--path-format=absolute', '--git-common-dir']).catch(() => '')).trim() || cwd
  projectFor.set(cwd, dir)
  return dir
}
const closedFor = new Map<string, { key: string; raw: string; at: number }>()
type EpicProgress = { done: number; total: number }

// shortcut: re-read at least every 30 s, in case readiness moves with time alone (a deferral running out).
const READY_TTL = 30_000

type Custom = { statuses: CustomStatus[]; types: string[] }
/** The statuses and types a workspace adds with `bd config set status.custom` / `types.custom`; read again after a minute. */
const customFor = new Map<string, { at: number; custom: Custom }>()
async function customOf(cwd: string): Promise<Custom> {
  const known = customFor.get(cwd)
  if (known && Date.now() - known.at < 60_000) return known.custom
  const [s, t] = await Promise.all([
    bd<{ custom_statuses?: CustomStatus[] }>(cwd, ['statuses']).catch(() => ({ custom_statuses: [] })),
    bd<{ custom_types?: string[] }>(cwd, ['types']).catch(() => ({ custom_types: [] }))
  ])
  const custom = {
    statuses: (s.custom_statuses ?? []).map((x) => ({ name: x.name, category: x.category })),
    types: (t.custom_types ?? []).filter((x) => typeof x === 'string' && !TYPES.includes(x) && !SYSTEM_TYPES.includes(x))
  }
  customFor.set(cwd, { at: Date.now(), custom })
  return custom
}

const bd = async <T>(cwd: string, args: string[]): Promise<T> => JSON.parse(await exec(cwd, 'bd', [...args, '--json'])) as T

/** The workspace's `.beads` folder, whether its Dolt database has a remote, and that database's own folder in embedded mode; read again after a minute. */
const remoteFor = new Map<string, { at: number; dir: string; has: boolean; db: string }>()
async function remoteOf(cwd: string): Promise<{ dir: string; has: boolean; db: string }> {
  const known = remoteFor.get(cwd)
  if (known && Date.now() - known.at < 60_000) return known
  const [where, remotes] = await Promise.all([
    bd<{ path?: string; database_path?: string }>(cwd, ['where']).catch(() => ({ path: '', database_path: '' })),
    bd<unknown[]>(cwd, ['dolt', 'remote', 'list']).catch(() => [])
  ])
  const dir = where.path ?? ''
  const meta = dir ? ((await readFile(join(dir, 'metadata.json'), 'utf8').then(JSON.parse).catch(() => ({}))) as { dolt_mode?: string; dolt_database?: unknown }) : {}
  // A plain name only: the repository wrote metadata.json, and this becomes a path.
  const name = typeof meta.dolt_database === 'string' && /^[\w-]{1,64}$/.test(meta.dolt_database) ? meta.dolt_database : ''
  const db = meta.dolt_mode === 'embedded' && name && where.database_path ? join(where.database_path, name) : ''
  const found = { at: Date.now(), dir, has: Boolean(dir) && Array.isArray(remotes) && remotes.length > 0, db }
  remoteFor.set(cwd, found)
  return found
}

/** A Dolt commit hash: 32 base32 characters, never something `dolt` could read as a flag. */
const isCommit = (c: unknown): c is string => typeof c === 'string' && /^[0-9a-v]{32}$/.test(c)

/**
 * How many commits `commit` is past `pushed` (all of its history when nothing was pushed), counted by the `dolt` CLI
 * in the database's folder, without the network. Undefined without `dolt`, or when it cannot say (the pushed commit squashed away).
 */
async function aheadOf(db: string, commit: string, pushed: string | undefined): Promise<number | undefined> {
  if (!db || !isCommit(commit) || (pushed !== undefined && !isCommit(pushed))) return undefined
  const out = await exec(db, 'dolt', ['log', '--oneline', pushed ? `${pushed}..${commit}` : commit]).catch(() => null)
  return out === null ? undefined : out.split('\n').filter((l) => l.trim()).length
}

/**
 * Whether `commit` is past what was last pushed. bd records that in `.beads/push-state.json` (per machine, git-ignored)
 * after its own auto-push; a sync from the panel records it there too. No record: nothing is known pushed.
 */
export function isUnpushed(commit: string | undefined, pushState: string): boolean {
  return Boolean(commit) && lastPushed(pushState) !== commit
}

/** The last commit push-state.json records, if it records one. */
function lastPushed(pushState: string): string | undefined {
  try {
    const c = (JSON.parse(pushState) as { last_commit?: unknown }).last_commit
    return typeof c === 'string' && c ? c : undefined
  } catch {
    return undefined
  }
}

const PUSH_STATE = 'push-state.json'

/** What the last look at the remote found: how many of its commits this database lacks, when it could tell. */
const fetchedFor = new Map<string, { at: number; behind?: number; running?: Promise<void> }>()
// shortcut: a look fetches over the network and holds the database meanwhile (~6 s), so it runs on its own every 10 minutes at most; `r` looks now.
const FETCH_TTL = 10 * 60_000

/** Fetches from the remote (`bd federation status`) and keeps how far behind it this database is; one look at a time. */
function fetchRemote(cwd: string): Promise<void> {
  const known = fetchedFor.get(cwd)
  if (known?.running) return known.running
  type Peer = { Reachable?: boolean; Status?: { Peer?: string; LocalBehind?: number } }
  const running = bd<{ peers?: Peer[] }>(cwd, ['federation', 'status'])
    .then((r) => {
      const peer = r.peers?.find((p) => p.Status?.Peer === 'origin') ?? r.peers?.[0]
      const behind = peer?.Reachable ? peer.Status?.LocalBehind : undefined
      // -1: the remote holds nothing of this branch yet, or bd could not compare.
      fetchedFor.set(cwd, { at: Date.now(), behind: typeof behind === 'number' && behind >= 0 ? behind : undefined })
    })
    .catch(() => {
      fetchedFor.set(cwd, { at: Date.now(), behind: known?.behind })
    })
  fetchedFor.set(cwd, { at: known?.at ?? 0, behind: known?.behind, running })
  return running
}

/** Orca puts its CLI path in the environment of what it starts; the PATH may not have it. */
const ORCA_CLI = process.env.ORCA_CLI_COMMAND || 'orca'

const orcaCli = async <T>(cwd: string, args: string[]): Promise<T> => JSON.parse(await exec(cwd, ORCA_CLI, [...args, '--json'])).result as T

/** The Orca repository a folder belongs to and the paths of its worktrees; null for a folder outside any repo. */
async function repoOf(path: string): Promise<{ id: string; paths: Set<string> } | null> {
  try {
    const { worktree } = await orcaCli<{ worktree: { repoId: string } }>(path, ['worktree', 'current'])
    const { worktrees } = await orcaCli<{ worktrees: { path: string }[] }>(path, ['worktree', 'list', '--repo', `id:${worktree.repoId}`])
    return { id: worktree.repoId, paths: new Set(worktrees.map((w) => w.path)) }
  } catch {
    return null
  }
}

function problemOf(err: unknown): { problem: BeadsProblem; error: string } {
  const e = err as { code?: string; stderr?: string; message: string }
  const error = (e.stderr || e.message).trim()
  if (e.code === 'ENOENT') return { problem: 'no-bd', error }
  if (/no beads database/i.test(error)) return { problem: 'no-database', error }
  if (/not found/i.test(error)) return { problem: 'not-found', error }
  return { problem: 'failed', error }
}

const invalid = (error: string) => ({ ok: false, problem: 'failed' as const, error })
const noWorkspace = { ok: false, problem: 'no-workspace' as const }

const BEAD_KEYS: (keyof Bead)[] = ['id', 'title', 'status', 'priority', 'issue_type', 'assignee', 'parent', 'labels', 'due_at', 'updated_at']

type ListRow = Bead & { dependencies?: { depends_on_id: string; type: string }[] }

/** Each row trimmed, with what it still waits on so the panel can say "waits on X" rather than "waiting". */
export function toBeads(rows: ListRow[]): Bead[] {
  const status = new Map(rows.map((r) => [r.id, r.status]))
  return rows.map((r) => {
    // Every unfinished bead is in `rows`; a blocker missing from it was closed before the window and waits on nothing.
    const waits = (r.dependencies ?? [])
      .filter((d) => d.type === 'blocks' && status.has(d.depends_on_id) && status.get(d.depends_on_id) !== 'closed')
      .map((d) => d.depends_on_id)
    return { ...pick(r, BEAD_KEYS), ...(waits.length ? { waits_on: waits } : {}) }
  })
}
/** bd's own bookkeeping beads: a `bd set-state` history, agent messages, swarm roots. They are not work. */
export const SYSTEM_TYPES = ['event', 'message', 'molecule']
const EXCLUDE = `--exclude-type=${SYSTEM_TYPES.join(',')}`
/** A built-in type, or a name a workspace may have added; bd refuses one it does not know. */
const isType = (t: unknown): t is string =>
  typeof t === 'string' && (TYPES.includes(t) || (/^[a-z][a-z0-9_-]{0,63}$/.test(t) && !SYSTEM_TYPES.includes(t) && t !== 'gate'))
const LINK_KEYS: (keyof BeadLink)[] = ['id', 'title', 'status', 'dependency_type']
const COMMENT_KEYS: (keyof BeadComment)[] = ['id', 'author', 'text', 'created_at']
const FIELDS = { due: 'due', defer: 'defer', estimate: 'estimate', 'external-ref': 'external-ref', 'spec-id': 'spec-id' } as const
/** A short free value: a name, a label, a date like `+1d` or `2026-12-01`, a reference. */
const isValue = (v: unknown): v is string => typeof v === 'string' && v.length <= 500 && !/[\n\r]/.test(v)
/** A new worktree's name: letters, digits, dots, dashes, underscores and slashes, never a flag or a way out of the repository. */
export const isWorktreeName = (n: string) => /^\w[\w./-]{0,99}$/.test(n) && !n.split('/').includes('..')
const isPriority = (p: unknown): p is number => Number.isInteger(p) && (p as number) >= 0 && (p as number) <= 4

/**
 * Orca's CLI arguments to start `agent` in the worktree at `path` with `prompt`. The CLI starts it the way a
 * new agent tab does (chat or terminal, per the person's setting) and hands the prompt over once the agent is
 * up: the host's `agent.launch` gives up on a slow-starting agent (Claude Code with plugins) and drops it.
 */
export const launchArgs = (agent: string, prompt: string, path: string) => [
  'agent', 'launch', '--agent', agent, '--worktree', `path:${path}`, '--prompt', prompt, '--json'
]

/** bd's arguments to store or forget a memory; a string says why not. */
export function memoryArgs(m: { action: string; key?: string; value?: string }): string[] | string {
  const key = m.key?.trim() ?? ''
  if (key && !/^[\w.:][\w.:-]{0,99}$/.test(key)) return 'A key is letters, digits, dots, dashes or colons.'
  if (m.action === 'forget') return key ? ['forget', '--', key] : 'Which memory?'
  if (m.action !== 'remember') return 'Unknown action.'
  const value = m.value?.trim() ?? ''
  if (!value || value.length > 20_000) return 'The memory is empty or too long.'
  return ['remember', ...(key ? [`--key=${key}`] : []), '--', value]
}

/** Who bd writes as: BEADS_ACTOR, then git user.name, as bd itself picks. Empty when neither is set. */
export async function actor(cwd: string): Promise<string> {
  return process.env.BEADS_ACTOR || (await exec(cwd, 'git', ['config', 'user.name']).catch(() => '')).trim()
}

/**
 * bd's arguments for one action. `--flag=value` keeps a value that starts with "-" from reading as a flag,
 * and the id comes after `--` so it is never one either.
 */
export async function argsFor(cwd: string, a: BeadAction): Promise<string[] | string> {
  const id = ['--', a.id]
  switch (a.action) {
    case 'claim':
      return ['update', '--claim', ...id]
    case 'close':
      return ['close', ...(a.reason?.trim() ? [`--reason=${a.reason.trim()}`] : []), ...id]
    case 'reopen':
      return ['reopen', ...id]
    case 'priority':
      return isPriority(a.priority) ? ['update', `--priority=${a.priority}`, ...id] : 'Invalid priority.'
    case 'assign-me': {
      const me = await actor(cwd)
      return me ? ['update', `--assignee=${me}`, ...id] : 'No git user name set (git config user.name).'
    }
    case 'unassign':
      return ['update', '--assignee=', ...id]
    case 'comment':
      // After `--`, a comment that starts with "-" stays text.
      return a.text?.trim() ? ['comments', 'add', ...id, a.text.trim()] : 'The comment is empty.'
    case 'edit': {
      const f = a.fields ?? {}
      if (f.title !== undefined && !f.title.trim()) return 'The title is empty.'
      if (f.type !== undefined && !isType(f.type)) return 'Invalid type.'
      const texts = ['description', 'acceptance', 'design', 'notes'] as const
      if (texts.some((k) => f[k] !== undefined && (typeof f[k] !== 'string' || f[k]!.length > 20_000)))
        return 'A text field is invalid.'
      const flags = [
        ...(f.title !== undefined ? [`--title=${f.title.trim()}`] : []),
        ...(f.type !== undefined ? [`--type=${f.type}`] : []),
        ...texts.filter((k) => f[k] !== undefined).map((k) => `--${k}=${f[k]!.trim()}`)
      ]
      return flags.length ? ['update', ...flags, ...id] : 'Nothing to change.'
    }
    case 'block':
    case 'unblock':
      if (!a.other || a.other === a.id) return 'Pick another task.'
      return ['dep', a.action === 'block' ? 'add' : 'remove', '--', a.id, a.other]
    case 'release':
      // The person takes the task back from whoever holds it, a crashed agent included.
      return ['unclaim', '--force', ...id]
    case 'duplicate':
    case 'supersede':
      if (!a.other || a.other === a.id) return 'Pick another task.'
      return [a.action, `--${a.action === 'duplicate' ? 'of' : 'with'}=${a.other}`, ...id]
    case 'status':
      // A built-in status, or a name bd may know from `status.custom` (bd refuses one it does not).
      // Closing and claiming by an agent go through their own commands.
      return STATUSES.includes(a.value ?? '') || (/^[a-z][a-z0-9_-]{0,63}$/.test(a.value ?? '') && a.value !== 'closed' && a.value !== 'hooked')
        ? ['update', `--status=${a.value}`, ...id]
        : 'Invalid status.'
    case 'assign':
      return isValue(a.value) && a.value.trim() ? ['update', `--assignee=${a.value.trim()}`, ...id] : 'Name someone.'
    case 'parent':
      if (a.other === a.id) return 'A task cannot be its own parent.'
      return ['update', `--parent=${a.other ?? ''}`, ...id]
    case 'label-add':
    case 'label-remove':
      if (!isValue(a.value) || !a.value.trim() || a.value.includes(',')) return 'Invalid label.'
      return ['update', `--${a.action === 'label-add' ? 'add' : 'remove'}-label=${a.value.trim()}`, ...id]
    case 'field': {
      const flag = a.field && Object.hasOwn(FIELDS, a.field) && FIELDS[a.field]
      if (!flag || !isValue(a.value ?? '')) return 'Invalid field.'
      const v = (a.value ?? '').trim()
      if (flag === 'estimate' && v && !/^\d{1,6}$/.test(v)) return 'The estimate is a number of minutes.'
      return ['update', `--${flag}=${flag === 'estimate' && !v ? '0' : v}`, ...id]
    }
    case 'link':
    case 'unlink':
      if (!a.other || a.other === a.id) return 'Pick another task.'
      return a.action === 'link' ? ['dep', 'add', '--type=related', '--', a.id, a.other] : ['dep', 'remove', '--', a.id, a.other]
    case 'delete':
      return ['delete', '--force', ...id]
    default:
      return 'Unknown action.'
  }
}

/** The file the board editor opens on: Orca only shows a plugin in its middle as the editor of a file. */
export const BOARD_FILE = '.beads-board'

/** Creates the board file once and keeps it out of git through the local, never committed `info/exclude`. */
async function boardFile(root: string): Promise<string> {
  const file = join(root, BOARD_FILE)
  // Never through a link: a repository could ship `.beads-board` pointing anywhere, and this would create that file.
  await (await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW)).close()
  const ignored = await exec(root, 'git', ['check-ignore', '-q', '--', BOARD_FILE]).then(() => true, () => false)
  if (!ignored) {
    // In a worktree `.git` is a file: git names the shared exclude file itself.
    const exclude = resolve(root, (await exec(root, 'git', ['rev-parse', '--git-path', 'info/exclude'])).trim())
    await mkdir(dirname(exclude), { recursive: true })
    const text = await readFile(exclude, 'utf8').catch(() => '')
    await appendFile(exclude, `${text && !text.endsWith('\n') ? '\n' : ''}/${BOARD_FILE}\n`)
  }
  return file
}

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('beads.list', async (input) => {
    const { ws } = await focused(orca)
    if (!ws) return { workspace: null, beads: [], ready: [], problem: 'no-workspace' as const }
    // Everything unfinished, but only what closed in the last `closedDays` (0: all): a repository's history can hold thousands.
    const closedDays = Number.isInteger(input?.closedDays) && input.closedDays! >= 0 ? input.closedDays! : 7
    const since = closedSince(closedDays)
    try {
      const open = await exec(ws.path, 'bd', ['list', EXCLUDE, '--flat', '--brief', '-n', '0', '--json'])
      const remote = await remoteOf(ws.path)
      const key = `${closedDays}\n${open}`
      let window = closedFor.get(ws.path)
      if (!(window && window.key === key && Date.now() - window.at < READY_TTL)) {
        const raw = await exec(ws.path, 'bd', ['list', EXCLUDE, '--status=closed', ...(since ? [`--closed-after=${since}`] : []), '--flat', '--brief', '-n', '0', '--json'])
        window = { key, raw, at: Date.now() }
        closedFor.set(ws.path, window)
      }
      const done = window.raw
      const raw = `${open}\n${done}`
      let known = readyFor.get(ws.path)
      if (!(known && known.list === raw && Date.now() - known.at < READY_TTL)) {
        const ready = (await bd<Bead[]>(ws.path, ['ready', EXCLUDE, '--brief', '-n', '0'])).map((r) => r.id)
        // An epic's progress counts every child it ever had, closed long ago included.
        const epics = Object.fromEntries(
          (await bd<{ epic: { id: string }; total_children: number; closed_children: number }[]>(ws.path, ['epic', 'status']).catch(() => [])).map((e) => [
            e.epic.id,
            { done: e.closed_children, total: e.total_children }
          ])
        )
        // bd count takes no --exclude-type: count by type and leave bd's own bookkeeping out.
        const byType = await bd<{ groups?: { group: string; count: number }[] }>(ws.path, ['count', '--status=closed', '--by-type']).catch(() => ({ groups: [] }))
        const closed = (byType.groups ?? []).filter((g) => !SYSTEM_TYPES.includes(g.group)).reduce((n, g) => n + g.count, 0)
        // bd commits every write: the local head moves with the list. No remote, nothing to push, no bd call.
        const commit = remote.has ? (await bd<{ commit?: string }>(ws.path, ['vc', 'status']).catch(() => ({ commit: undefined }))).commit : undefined
        const pushed = commit ? lastPushed(await readFile(join(remote.dir, PUSH_STATE), 'utf8').catch(() => '')) : undefined
        const ahead = commit ? await aheadOf(remote.db, commit, pushed) : undefined
        known = { list: raw, ready, epics, closed, commit, ahead, at: Date.now() }
        readyFor.set(ws.path, known)
      }
      const { ready, epics, closed } = known
      const unpushed = remote.has && isUnpushed(known.commit, await readFile(join(remote.dir, PUSH_STATE), 'utf8').catch(() => ''))
      const ahead = unpushed ? known.ahead : undefined
      if (remote.has) {
        // Last, so the list's own bd calls do not wait behind the network.
        const fetched = fetchedFor.get(ws.path)
        if (input?.fetch) await fetchRemote(ws.path)
        else if (!fetched || (!fetched.running && Date.now() - fetched.at > FETCH_TTL)) void fetchRemote(ws.path)
      }
      const behind = remote.has ? fetchedFor.get(ws.path)?.behind : undefined
      // The panel already has this exact answer: say so instead of sending the whole list again.
      const version = createHash('sha1').update(`${ws.path}\n${closedDays}\n${raw}\n${ready.join(',')}\n${remote.has}\n${unpushed}\n${ahead}\n${behind}`).digest('hex').slice(0, 16)
      const [me, project] = await Promise.all([actor(ws.path), projectOf(ws.path)])
      if (input?.since === version) return { workspace: ws.path, beads: [], ready: [], version, unchanged: true, me, project }
      const { statuses, types } = await customOf(ws.path)
      const rows = [...(JSON.parse(open) as ListRow[]), ...(JSON.parse(done) as ListRow[])]
      return plain({ workspace: ws.path, beads: toBeads(rows), ready, version, me, project, statuses, types, closedDays, closedTotal: closed, epics, remote: remote.has, unpushed, ahead, behind })
    } catch (err) {
      return { workspace: ws.path, beads: [], ready: [], ...problemOf(err) }
    }
  })

  orca.panels.handle('beads.workspace', async () => ({ workspace: (await focused(orca)).ws?.path ?? null }))

  orca.panels.handle('beads.show', async ({ id }) => {
    const { ws } = await focused(orca)
    if (!ws) return { bead: null, problem: 'no-workspace' as const }
    try {
      const [row] = await bd<BeadDetail[]>(ws.path, ['show', `--id=${id}`, '--include-dependents', '--brief-deps', '--include-comments'])
      if (!row) return { bead: null, problem: 'not-found' as const }
      const links = (list?: (BeadLink & { issue_type?: string })[]) =>
        list?.filter((l) => !SYSTEM_TYPES.includes(l.issue_type ?? '')).map((l) => pick(l, LINK_KEYS))
      const comments = row.comments?.map((c) => pick(c, COMMENT_KEYS))
      return plain({ bead: { ...row, dependencies: links(row.dependencies), dependents: links(row.dependents), comments } })
    } catch (err) {
      return { bead: null, ...problemOf(err) }
    }
  })

  orca.panels.handle('beads.act', async (action) => {
    const { ws } = await focused(orca)
    if (!ws) return noWorkspace
    try {
      const args = await argsFor(ws.path, action)
      if (typeof args === 'string') return invalid(args)
      // Only the exit code matters: some answers ("already open") are plain text even with --json.
      await exec(ws.path, 'bd', args).catch(async (err) => {
        // bd claims only a task still to do. From a review, blocked or deferred, taking it is setting it in progress, yours.
        if (action.action !== 'claim' || !/not claimable: status/.test(problemOf(err).error)) throw err
        const me = await actor(ws.path)
        return exec(ws.path, 'bd', ['update', '--status=in_progress', ...(me ? [`--assignee=${me}`] : []), '--', action.id])
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, ...problemOf(err) }
    }
  })

  orca.panels.handle('beads.sync', async () => {
    const { ws } = await focused(orca)
    if (!ws) return noWorkspace
    try {
      const remote = await remoteOf(ws.path)
      if (!remote.has) return invalid('This database has no Dolt remote (bd dolt remote add).')
      // Pull, conflict check, push; holds the database throughout, other bd commands wait their turn.
      // --no-adopt: never a remote made up from git origin. A conflict halts it with nothing pushed, exit 2.
      await exec(ws.path, 'bd', ['sync', '--no-adopt', '--json']).catch((err) => {
        // bd tells why (status, conflicting rows) on stdout; keep it for the details.
        const out = (err as { stdout?: string }).stdout?.trim()
        if (out) (err as { stderr?: string }).stderr = [(err as { stderr?: string }).stderr?.trim(), out].filter(Boolean).join('\n\n')
        throw err
      })
      const { commit } = await bd<{ commit: string }>(ws.path, ['vc', 'status'])
      // Never through a link: a repository could ship `.beads/push-state.json` pointing anywhere.
      const file = await open(join(remote.dir, PUSH_STATE), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW)
      await file.writeFile(JSON.stringify({ last_push: new Date().toISOString(), last_commit: commit }, null, 2)).finally(() => file.close())
      fetchedFor.set(ws.path, { at: Date.now(), behind: 0 })
      readyFor.delete(ws.path)
      return { ok: true }
    } catch (err) {
      return { ok: false, ...problemOf(err) }
    }
  })

  orca.panels.handle('beads.searchClosed', async ({ q, before }) => {
    const query = q?.trim() ?? ''
    if (!query || query.length > 200 || !/^\d{4}-\d{2}-\d{2}$/.test(before ?? '')) return { beads: [] }
    const { ws } = await focused(orca)
    if (!ws) return { beads: [], problem: 'no-workspace' as const }
    try {
      // After `--`, a query that starts with "-" stays a query.
      // bd search takes no --exclude-type: bd's own bookkeeping is left out here.
      const rows = JSON.parse(await exec(ws.path, 'bd', ['search', '--status=closed', `--closed-before=${before}`, '-n', '50', '--json', '--', query])) as ListRow[]
      return plain({ beads: toBeads(rows.filter((r) => !SYSTEM_TYPES.includes(r.issue_type ?? ''))) })
    } catch (err) {
      return { beads: [], ...problemOf(err) }
    }
  })

  orca.panels.handle('beads.board', async () => {
    const { ws } = await focused(orca)
    if (!ws) return noWorkspace
    try {
      await boardFile(ws.path)
      await orca.host.call('editor.open', { workspaceId: ws.id, path: BOARD_FILE })
      return { ok: true }
    } catch (err) {
      return { ok: false, ...problemOf(err) }
    }
  })

  orca.panels.handle('beads.memories', async () => {
    const { ws } = await focused(orca)
    if (!ws) return { memories: [], problem: 'no-workspace' as const }
    try {
      const { schema_version: _, ...all } = await bd<Record<string, unknown>>(ws.path, ['memories'])
      const memories = Object.entries(all)
        .filter((e): e is [string, string] => typeof e[1] === 'string')
        .map(([key, value]) => ({ key, value }))
        .sort((a, b) => a.key.localeCompare(b.key))
      return { memories }
    } catch (err) {
      return { memories: [], ...problemOf(err) }
    }
  })

  orca.panels.handle('beads.memory', async (input) => {
    const args = memoryArgs(input)
    if (typeof args === 'string') return invalid(args)
    const { ws } = await focused(orca)
    if (!ws) return noWorkspace
    try {
      await exec(ws.path, 'bd', args)
      return { ok: true }
    } catch (err) {
      return { ok: false, ...problemOf(err) }
    }
  })

  orca.panels.handle('beads.create', async ({ title, type, priority, parent, description, labels, due, estimate }) => {
    if (!title.trim()) return invalid('The title is empty.')
    if (!isType(type) || !isPriority(priority)) return invalid('Invalid type or priority.')
    if (description !== undefined && (typeof description !== 'string' || description.length > 20_000))
      return invalid('Invalid description.')
    if (labels !== undefined && (!Array.isArray(labels) || !labels.every((l) => isValue(l) && l.trim() && !l.includes(','))))
      return invalid('Invalid labels.')
    if (due !== undefined && !isValue(due)) return invalid('Invalid due date.')
    if (estimate !== undefined && !(Number.isInteger(estimate) && estimate >= 0 && estimate < 1e6)) return invalid('Invalid estimate.')
    const { ws } = await focused(orca)
    if (!ws) return noWorkspace
    try {
      const args = ['create', `--title=${title.trim()}`, `--type=${type}`, `--priority=${priority}`]
      if (parent) args.push(`--parent=${parent}`)
      if (description?.trim()) args.push(`--description=${description.trim()}`)
      if (labels?.length) args.push(`--labels=${labels.map((l) => l.trim()).join(',')}`)
      if (due?.trim()) args.push(`--due=${due.trim()}`)
      if (estimate) args.push(`--estimate=${estimate}`)
      const created = await bd<{ id: string }>(ws.path, args)
      return { ok: true, id: created.id }
    } catch (err) {
      return { ok: false, ...problemOf(err) }
    }
  })

  orca.panels.handle('beads.targets', async () => {
    const [{ ws, all }, agents] = await Promise.all([focused(orca), availableAgents()])
    if (!ws) return { current: null, workspaces: [], ...agents }
    const repo = await repoOf(ws.path)
    const siblings = all.filter((w) => w.id !== ws.id && w.hostId === ws.hostId && repo?.paths.has(w.path))
    return plain({ current: ws.id, workspaces: [ws, ...siblings].map((w) => pick(w, ['id', 'name', 'branch'])), ...agents })
  })

  orca.panels.handle('beads.launch', async ({ agent, prompt, target, name }) => {
    // A prompt starting with "-" would read as a flag to Orca's CLI.
    if (!prompt.trim() || prompt.trimStart().startsWith('-')) return invalid('The prompt is empty or starts with "-".')
    if (!AGENTS.some((a) => a.id === agent)) return invalid('Unknown agent.')
    const { ws, all } = await focused(orca)
    if (!ws) return noWorkspace
    try {
      if (target !== 'new') {
        const into = all.find((w) => w.id === target)
        if (!into) return invalid('That worktree no longer exists.')
        await exec(ws.path, ORCA_CLI, launchArgs(agent, prompt, into.path))
        return { ok: true, where: into.name }
      }
      const repo = await repoOf(ws.path)
      const worktree = name?.trim() ?? ''
      if (!repo) return invalid('This workspace is not a git repository: no worktree can be made from it.')
      if (!isWorktreeName(worktree)) return invalid('Invalid worktree name.')
      // The plugin API cannot create worktrees; Orca's own CLI can, and starts the agent there.
      await exec(ws.path, ORCA_CLI, [
        'worktree', 'create', '--name', worktree, '--repo', `id:${repo.id}`,
        '--parent-worktree', `path:${ws.path}`, '--agent', agent, '--prompt', prompt, '--json'
      ])
      return { ok: true, where: worktree }
    } catch (err) {
      return { ok: false, ...problemOf(err) }
    }
  })
}
