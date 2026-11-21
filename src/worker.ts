// Runs `bd` in the focused workspace's folder; panels cannot run processes, the worker can.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import type { OrcaWorkerApi } from 'orca/worker'
import { AGENTS, availableAgents } from './agents'
import { STATUSES, TYPES } from './model'
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

/** bd runs one at a time: two bd processes on one database slow each other down (measured: 1.0 s in parallel, 0.7 s in turn). */
let bdTurn: Promise<unknown> = Promise.resolve()

async function exec(cwd: string, file: string, args: string[]): Promise<string> {
  const go = async () => (await run(file, args, { cwd, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })).stdout
  if (file !== 'bd') return go()
  const turn = bdTurn.then(go, go)
  bdTurn = turn.catch(() => {})
  return turn
}

/** `bd ready` per workspace, kept while the list it was read with is unchanged; it costs a whole bd process. */
const readyFor = new Map<string, { list: string; ready: string[]; at: number }>()
// shortcut: re-read at least every 30 s, in case readiness moves with time alone (a deferral running out).
const READY_TTL = 30_000

const bd = async <T>(cwd: string, args: string[]): Promise<T> => JSON.parse(await exec(cwd, 'bd', [...args, '--json'])) as T

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
    const waits = (r.dependencies ?? [])
      .filter((d) => d.type === 'blocks' && status.get(d.depends_on_id) !== 'closed')
      .map((d) => d.depends_on_id)
    return { ...pick(r, BEAD_KEYS), ...(waits.length ? { waits_on: waits } : {}) }
  })
}
const LINK_KEYS: (keyof BeadLink)[] = ['id', 'title', 'status', 'dependency_type']
const COMMENT_KEYS: (keyof BeadComment)[] = ['id', 'author', 'text', 'created_at']
const FIELDS = { due: 'due', defer: 'defer', estimate: 'estimate', 'external-ref': 'external-ref', 'spec-id': 'spec-id' } as const
/** A short free value: a name, a label, a date like `+1d` or `2026-12-01`, a reference. */
const isValue = (v: unknown): v is string => typeof v === 'string' && v.length <= 500 && !/[\n\r]/.test(v)
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
      if (f.type !== undefined && !TYPES.includes(f.type)) return 'Invalid type.'
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
      return STATUSES.includes(a.value ?? '') ? ['update', `--status=${a.value}`, ...id] : 'Invalid status.'
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
      const flag = a.field && FIELDS[a.field]
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

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('beads.list', async (input) => {
    const { ws } = await focused(orca)
    if (!ws) return { workspace: null, beads: [], ready: [], problem: 'no-workspace' as const }
    try {
      const raw = await exec(ws.path, 'bd', ['list', '--all', '--flat', '--brief', '-n', '0', '--json'])
      const known = readyFor.get(ws.path)
      const ready =
        known && known.list === raw && Date.now() - known.at < READY_TTL
          ? known.ready
          : (await bd<Bead[]>(ws.path, ['ready', '--brief', '-n', '0'])).map((r) => r.id)
      if (ready !== known?.ready) readyFor.set(ws.path, { list: raw, ready, at: Date.now() })
      // The panel already has this exact answer: say so instead of sending the whole list again.
      const version = createHash('sha1').update(`${ws.path}\n${raw}\n${ready.join(',')}`).digest('hex').slice(0, 16)
      const me = await actor(ws.path)
      if (input?.since === version) return { workspace: ws.path, beads: [], ready: [], version, unchanged: true, me }
      return plain({ workspace: ws.path, beads: toBeads(JSON.parse(raw) as ListRow[]), ready, version, me })
    } catch (err) {
      return { workspace: ws.path, beads: [], ready: [], ...problemOf(err) }
    }
  })

  orca.panels.handle('beads.show', async ({ id }) => {
    const { ws } = await focused(orca)
    if (!ws) return { bead: null, problem: 'no-workspace' as const }
    try {
      const [row] = await bd<BeadDetail[]>(ws.path, ['show', `--id=${id}`, '--include-dependents', '--brief-deps', '--include-comments'])
      if (!row) return { bead: null, problem: 'not-found' as const }
      const links = (list?: BeadLink[]) => list?.map((l) => pick(l, LINK_KEYS))
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
      await exec(ws.path, 'bd', args)
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
    if (!TYPES.includes(type) || !isPriority(priority)) return invalid('Invalid type or priority.')
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
      if (!worktree || worktree.startsWith('-')) return invalid('Invalid worktree name.')
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
