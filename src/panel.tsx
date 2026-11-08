// No build step: Orca strips the types and compiles the JSX when the panel loads.
import {
  atom,
  Badge,
  Box,
  Button,
  Code,
  CodeView,
  Collapsible,
  EmptyState,
  env,
  Heading,
  IconButton,
  Input,
  KeyValue,
  List,
  ListItem,
  Progress,
  RelativeTime,
  Markdown,
  on,
  plugin,
  read,
  Row,
  Select,
  set,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Text,
  Textarea,
  type PanelContext
} from 'orca'
import { messages } from './i18n'
import './protocol'

type Problem = { problem?: BeadsProblem; error?: string }
type ListAnswer = { workspace: string | null; beads: Bead[]; ready: string[] } & Problem
type ShowAnswer = { bead: BeadDetail | null } & Problem

const list = atom<ListAnswer | null>(null)
/** The bead open in the detail view, or null for the list; each workspace remembers its own. */
const openId = atom<string | null>('openId', null, { persist: 'workspace' })
/** The last answer for a bead, tagged with its id so another bead's answer never shows under this one. */
const detail = atom<{ id: string; answer: ShowAnswer } | null>(null)
// All is the default view; a new key so earlier saved choices do not override it.
const tab = atom('filter', 'all', { persist: 'plugin' })

type Ref = { id: string; title: string }
/** A form drawn over the list or the detail: a new bead, or starting an agent on one. */
type Form = { kind: 'create'; parent: Ref | null } | { kind: 'launch'; bead: Ref } | { kind: 'edit'; bead: Ref }
// Forms and their drafts survive closing the panel, per workspace, like an unsent message.
const form = atom<Form | null>('form', null, { persist: 'workspace' })
const draft = atom(
  'draft',
  { title: '', type: 'task', priority: '2', description: '', parent: '' },
  { persist: 'workspace' }
)
/** Which agent was launched on which task, until the agent claims it: a second Start is then a deliberate one. */
const launched = atom<Record<string, string>>('launched', {}, { persist: 'workspace' })
const launch = atom('launch', { agent: '', target: '', name: '', prompt: '' }, { persist: 'workspace' })
type Targets = { workspaces: LaunchTarget[]; agents: { id: string; name: string }[] }
const targets = atom<Targets | null>(null)
/** The comment being written on the open bead. */
const comment = atom('')
/** The close reason being typed; null when no close is being confirmed. */
const closing = atom<{ how: 'done' | 'duplicate' | 'supersede'; reason: string; other: string } | null>(null)
/** The bead whose release is being confirmed. */
const releasing = atom<string | null>(null)
/** A bead's editable fields, drafted; kept per workspace like the other forms. */
const editDraft = atom(
  'editDraft',
  { title: '', type: 'task', description: '', acceptance: '', design: '', notes: '' },
  { persist: 'workspace' }
)
const query = atom('query', '', { persist: 'workspace' })
/** Orca's Select refuses an empty value, so "none picked" has its own. */
const NONE = 'none'
const busy = atom(false)
/** What the last write said: a success line, or why it failed. */
const outcome = atom<({ notice?: string } & Problem) | null>(null)

const failed = (err: unknown) => (err as Error).message

/** The words for Orca's UI language. */
const t = () => messages(env.locale)

async function refreshList(): Promise<void> {
  try {
    set(list, await plugin.request('beads.list'))
  } catch (err) {
    set(list, { workspace: null, beads: [], ready: [], problem: 'failed', error: failed(err) })
  }
}

async function loadDetail(id: string): Promise<void> {
  try {
    const answer = await plugin.request('beads.show', { id })
    if (read(openId) === id) set(detail, { id, answer }) // a later click wins
  } catch (err) {
    if (read(openId) === id) set(detail, { id, answer: { bead: null, problem: 'failed', error: failed(err) } })
  }
}

function open(id: string): void {
  set(openId, id)
  set(detail, null)
  set(closing, null)
  set(releasing, null)
  set(comment, '')
  set(outcome, null)
  void loadDetail(id)
}

function back(): void {
  set(openId, null)
  set(detail, null)
  set(form, null)
}

function closeForm(): void {
  set(form, null)
  set(outcome, null)
}

/** Runs one write, then reloads; its result lands in `outcome` for the view to show. */
async function write<R extends ActResult>(task: () => Promise<R>, notice?: (r: R) => string): Promise<R | null> {
  set(busy, true)
  set(outcome, null)
  try {
    const r = await task()
    set(outcome, r.ok ? { notice: notice?.(r) } : { problem: r.problem ?? 'failed', error: r.error })
    if (r.ok) refresh()
    return r.ok ? r : null
  } catch (err) {
    set(outcome, { problem: 'failed', error: failed(err) })
    return null
  } finally {
    set(busy, false)
  }
}

const act = (a: BeadAction, notice?: string) =>
  write(
    () => plugin.request('beads.act', a),
    () => notice ?? ''
  )

async function addComment(id: string): Promise<void> {
  const text = read(comment)
  if (!text.trim()) return
  if (await act({ id, action: 'comment', text }, t().commented)) set(comment, '')
}

async function confirmClose(id: string): Promise<void> {
  const c = read(closing)
  if (!c) return
  const done =
    c.how === 'done'
      ? await act({ id, action: 'close', reason: c.reason }, t().closed)
      : await act({ id, action: c.how, other: c.other }, t().closed)
  if (done) set(closing, null)
}

async function confirmRelease(id: string): Promise<void> {
  if (await act({ id, action: 'release' }, t().released)) set(releasing, null)
}

function openEdit(b: BeadDetail): void {
  set(editDraft, {
    title: b.title,
    type: b.issue_type ?? 'task',
    description: b.description ?? '',
    acceptance: b.acceptance_criteria ?? '',
    design: b.design ?? '',
    notes: b.notes ?? ''
  })
  set(outcome, null)
  set(form, { kind: 'edit', bead: { id: b.id, title: b.title } })
}

async function submitEdit(id: string): Promise<void> {
  const d = read(editDraft)
  if (!d.title.trim()) return
  if (await act({ id, action: 'edit', fields: d }, t().saved)) set(form, null)
}

function openCreate(parent: Ref | null, type = 'task', title = ''): void {
  set(draft, { title, type, priority: '2', description: '', parent: parent?.id ?? '' })
  set(outcome, null)
  set(form, { kind: 'create', parent })
}

/** Creates the drafted task, then opens it, or with `andStart` goes straight to launching an agent on it. */
async function submitCreate(andStart = false): Promise<void> {
  const d = read(draft)
  if (!d.title.trim()) return
  const r = await write(() =>
    // Optional keys are left out rather than undefined: Orca refuses requests that are not JSON.
    plugin.request('beads.create', {
      title: d.title,
      type: d.type,
      priority: Number(d.priority),
      ...(d.parent ? { parent: d.parent } : {}),
      ...(d.description?.trim() ? { description: d.description } : {})
    })
  )
  if (!r?.id) return
  open(r.id)
  if (andStart) void openLaunch({ id: r.id, title: d.title.trim() })
  else set(form, null)
}

/** What the agent is told by default; the person can rewrite it before launching. */
export const promptFor = (b: Ref) => t().promptFor(b.id)

async function openLaunch(bead: Ref): Promise<void> {
  set(launch, { agent: '', target: '', name: bead.id, prompt: promptFor(bead) })
  set(outcome, null)
  set(form, { kind: 'launch', bead })
  await loadTargets()
}

/** What the launch form can offer; a choice already made (a remembered draft) stays when still offered. */
async function loadTargets(): Promise<void> {
  set(targets, null)
  try {
    const t = await plugin.request('beads.targets')
    set(targets, { workspaces: t.workspaces, agents: t.agents })
    const l = read(launch)
    const agentOk = t.agents.some((a) => a.id === l.agent)
    const targetOk = l.target === 'new' || t.workspaces.some((w) => w.id === l.target)
    set(launch, {
      ...l,
      // Orca's default agent first; with none, the first one Orca would offer.
      agent: agentOk ? l.agent : (t.defaultAgent ?? t.agents[0]?.id ?? ''),
      target: targetOk ? l.target : (t.current ?? 'new')
    })
  } catch {
    set(targets, { workspaces: [], agents: [] })
    set(launch, { ...read(launch), target: 'new' })
  }
}

async function submitLaunch(): Promise<void> {
  const f = read(form)
  const l = read(launch)
  const agentName = read(targets)?.agents.find((a) => a.id === l.agent)?.name ?? l.agent
  const r = await write(
    // A new worktree runs its setup before the agent starts: give it the longest wait Orca allows.
    () =>
      plugin.request(
        'beads.launch',
        { agent: l.agent, prompt: l.prompt, target: l.target, name: l.name },
        { timeoutMs: 120_000 }
      ),
    (r) => t().launched(agentName, r.where ?? '')
  )
  if (r) {
    if (f?.kind === 'launch') set(launched, { ...read(launched), [f.bead.id]: agentName })
    set(form, null)
  }
}

function refresh(): void {
  void refreshList()
  const id = read(openId)
  if (id) void loadDetail(id)
}

const byUpdatedDesc = (a: Bead, b: Bead) => b.updated_at.localeCompare(a.updated_at)
const byPriority = (a: Bead, b: Bead) => a.priority - b.priority || a.id.localeCompare(b.id)
const isDoing = (b: Bead) => b.status === 'in_progress' || b.status === 'hooked'

/** Current = the most recently touched in-progress bead; the rest split into todo / in progress / done. */
export function group(beads: Bead[]) {
  // An epic in progress is a container, never the task someone is doing.
  const doing = beads.filter((b) => isDoing(b) && b.issue_type !== 'epic').sort(byUpdatedDesc)
  return {
    current: doing[0] ?? null,
    inProgress: doing.slice(1),
    todo: beads.filter((b) => b.status !== 'closed' && !isDoing(b)).sort(byPriority),
    done: beads.filter((b) => b.status === 'closed').sort(byUpdatedDesc)
  }
}

export function setup(ctx: PanelContext): void {
  // workspace.changed also fires on subscribe, but loading now keeps the panel alive without it.
  refresh()
  ctx.subscriptions.push(
    // Another workspace brings back its own open bead and forms: reload what they show.
    on('workspace.changed', () => {
      refresh()
      if (read(form)?.kind === 'launch') void loadTargets()
    })
  )
  if (read(form)?.kind === 'launch') void loadTargets()
  // Agents are what move beads around: reload when one changes state.
  ctx.subscriptions.push(on('agent.status.changed', refresh))
}

const TONES: Record<string, 'neutral' | 'accent' | 'success' | 'warning'> = {
  in_progress: 'accent',
  hooked: 'accent',
  blocked: 'warning',
  closed: 'success'
}
const statusOf = (s: string) => ({ label: t().status[s] ?? s, tone: TONES[s] ?? ('neutral' as const) })

const TYPE_ICONS: Record<string, 'bug' | 'layers' | 'lightbulb' | 'wrench'> = {
  bug: 'bug',
  epic: 'layers',
  feature: 'lightbulb',
  chore: 'wrench'
}

/**
 * A state glyph when the state matters (done, moving, waiting...), else the task's type.
 * Never a chevron: rows open a task, they do not expand. `ready` tells open beads that can start from waiting ones.
 */
function iconOf(b: { status: string; issue_type?: string }, ready: Set<string> | null) {
  if (b.status === 'closed') return 'check'
  if (isDoing(b as Bead)) return 'activity'
  if (b.status === 'deferred') return 'calendar'
  if (b.status === 'pinned') return 'star'
  if (b.status === 'blocked' || (ready && !ready.has((b as Bead).id))) return 'pause'
  return typeIcon(b)
}

const typeIcon = (b: { issue_type?: string }) => TYPE_ICONS[b.issue_type ?? ''] ?? 'file-text'

/** Blockers by title: an id says nothing at a glance. */
const titleOf = (id: string) => read(list)?.beads.find((b) => b.id === id)?.title ?? id
const waiting = (b: Bead) => (b.waits_on?.length ? t().waitsOn(b.waits_on.map(titleOf).join(', ')) : t().waiting)

// What decides the next move comes first; the id, for `bd` and agents, comes last.
const meta = (b: Bead, blocked: boolean) =>
  [`P${b.priority}`, blocked ? waiting(b) : null, b.assignee, b.id].filter(Boolean).join(' · ')

/** Headings inside a task's text become bold lines, so they never outrank the panel's own sections. */
export const flat = (md: string) => md.replace(/^#{1,6}[ \t]+(.+?)[ \t#]*$/gm, '**$1**')

/** `byType`: the list already says the state (a titled section), so each row shows its type instead. */
function BeadList({
  label,
  beads,
  ready,
  byType = false
}: {
  label: string
  beads: Bead[]
  ready: Set<string>
  byType?: boolean
}) {
  return (
    <List label={label}>
      {beads.map((b) => {
        const state = iconOf(b, ready)
        return (
          <ListItem
            title={b.title}
            description={meta(b, state === 'pause')}
            icon={byType ? typeIcon(b) : state}
            onPress={() => open(b.id)}
          />
        )
      })}
    </List>
  )
}

function Section({
  title,
  beads,
  ready,
  open,
  byType = false
}: {
  title: string
  beads: Bead[]
  ready: Set<string>
  open: boolean
  byType?: boolean
}) {
  if (beads.length === 0) return null
  return (
    <Collapsible title={`${title} (${beads.length})`} defaultOpen={open}>
      <BeadList label={title} beads={beads} ready={ready} byType={byType} />
    </Collapsible>
  )
}

/** Title or id contains every word of the query, any case. */
export const matches = (b: Bead, q: string) =>
  q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => `${b.title} ${b.id}`.toLowerCase().includes(word))

/** Work order: what is moving, then what is open by priority, then what is done. */
const rank = (b: Bead) => (isDoing(b) ? 0 : b.status === 'closed' ? 2 : 1)
const byWorkOrder = (a: Bead, b: Bead) => rank(a) - rank(b) || byPriority(a, b)

/** Each bead under its nearest epic ancestor; beads with none are `loose`. */
export function byEpic(beads: Bead[]) {
  const byId = new Map(beads.map((b) => [b.id, b]))
  const epicOf = (b: Bead) => {
    const seen = new Set<string>() // a parent cycle must not loop forever
    let p = b.parent ? byId.get(b.parent) : undefined
    while (p && !seen.has(p.id)) {
      if (p.issue_type === 'epic') return p.id
      seen.add(p.id)
      p = p.parent ? byId.get(p.parent) : undefined
    }
    return null
  }
  const children = new Map<string, Bead[]>()
  const loose: Bead[] = []
  for (const b of beads) {
    if (b.issue_type === 'epic') continue
    const epic = epicOf(b)
    if (epic) children.set(epic, [...(children.get(epic) ?? []), b])
    else loose.push(b)
  }
  const epics = beads
    .filter((b) => b.issue_type === 'epic')
    .sort(byWorkOrder)
    .map((epic) => {
      const kids = (children.get(epic.id) ?? []).sort(byWorkOrder)
      return { epic, children: kids, done: kids.filter((b) => b.status === 'closed').length }
    })
  return { epics, loose: loose.sort(byWorkOrder) }
}

function EpicSection({
  epic,
  children,
  done,
  ready
}: ReturnType<typeof byEpic>['epics'][number] & { ready: Set<string> }) {
  const total = children.length
  return (
    <Collapsible
      title={epic.title}
      description={total ? `${t().epicDone(done, total)} · ${epic.id}` : epic.id}
      defaultOpen={false}
    >
      <Stack gap="sm">
        {total > 0 && (
          <Progress label={t().epicProgress(epic.title)} labelHidden value={Math.round((done / total) * 100)} />
        )}
        {total ? (
          <BeadList label={epic.title} beads={children} ready={ready} />
        ) : (
          <Text muted size="sm">
            {t().noChildren}
          </Text>
        )}
        <Row gap="xs" wrap>
          <Button variant="ghost" size="sm" icon="info" onPress={() => open(epic.id)}>
            {t().epicDetail}
          </Button>
          <Button variant="ghost" size="sm" icon="add" onPress={() => openCreate(epic)}>
            {t().addBead}
          </Button>
        </Row>
      </Stack>
    </Collapsible>
  )
}

function EpicsTab({ beads, ready }: { beads: Bead[]; ready: Set<string> }) {
  const { epics, loose } = byEpic(beads)
  if (epics.length === 0)
    return (
      <EmptyState icon="layers" title={t().noEpics} description={t().noEpicsHint}>
        <Button variant="outline" size="sm" icon="add" onPress={() => openCreate(null, 'epic')}>
          {t().newEpic}
        </Button>
      </EmptyState>
    )
  return (
    <Stack gap="sm">
      {epics.map((e) => (
        <EpicSection {...e} ready={ready} />
      ))}
      <Section title={t().noEpic} beads={loose} ready={ready} open={false} />
    </Stack>
  )
}

function ListView({ answer }: { answer: ListAnswer }) {
  const ready = new Set(answer.ready)
  const { current, inProgress, todo, done } = group(answer.beads)
  const readyBeads = todo.filter((b) => ready.has(b.id))
  const blocked = todo.filter((b) => b.status === 'blocked' || (b.status === 'open' && !ready.has(b.id)))
  // You and your agents can each be on a task: show every one, newest first.
  const doing = current ? [current, ...inProgress] : []
  const heading = doing.length > 1 ? `${t().inProgress} (${doing.length})` : t().currentBead
  const q = read(query)
  const found = q.trim() ? answer.beads.filter((b) => matches(b, q)).sort(byWorkOrder) : []
  return (
    <Stack gap="lg">
      <Input
        type="search"
        label={t().search}
        labelHidden
        value={q}
        placeholder={t().searchPlaceholder}
        onChange={(v) => set(query, v)}
        // Enter on a search with no match turns it into a new task.
        onSubmit={() => q.trim() && !found.length && openCreate(null, 'task', q.trim())}
      />
      {!q.trim() && (
        <Stack gap="xs">
          <Heading level={3}>{heading}</Heading>
          {doing.length ? (
            // One list per task: highlighted rows in a shared list touch, separate ones keep a gap.
            <Stack gap="xs">
              {doing.map((b) => (
                <List label={b.title}>
                  <ListItem
                    title={b.title}
                    description={meta(b, false)}
                    icon="activity"
                    current
                    onPress={() => open(b.id)}
                  />
                </List>
              ))}
            </Stack>
          ) : (
            <Text muted size="sm">
              {t().noCurrentBead}
            </Text>
          )}
        </Stack>
      )}
      {q.trim() ? (
        found.length ? (
          <BeadList label={t().search} beads={found} ready={ready} />
        ) : (
          <EmptyState icon="search" title={t().noMatch(q.trim())}>
            <Button variant="outline" size="sm" icon="add" onPress={() => openCreate(null, 'task', q.trim())}>
              {t().createNamed(q.trim())}
            </Button>
          </EmptyState>
        )
      ) : (
        <Tabs label={t().filter} value={read(tab)} onChange={(v) => set(tab, v)}>
          <Tab value="all" label={`${t().all} (${answer.beads.length})`}>
            <Stack gap="sm">
              <Section byType title={t().blocked} beads={blocked} ready={ready} open={false} />
              <Section byType title={t().todo} beads={todo.filter((b) => !blocked.includes(b))} ready={ready} open />
              {/* Epics in progress included: All lists everything. */}
              <Section
                byType
                title={t().inProgress}
                beads={answer.beads.filter(isDoing).sort(byUpdatedDesc)}
                ready={ready}
                open={false}
              />
              <Section byType title={t().done} beads={done} ready={ready} open={false} />
              {answer.beads.length === 0 && (
                <EmptyState icon="layers" title={t().noBeads} description={t().noBeadsHint}>
                  <Button variant="outline" size="sm" icon="add" onPress={() => openCreate(null)}>
                    {t().newBead}
                  </Button>
                </EmptyState>
              )}
            </Stack>
          </Tab>
          <Tab value="ready" label={`${t().ready} (${readyBeads.length})`}>
            {readyBeads.length ? (
              <BeadList label={t().ready} beads={readyBeads} ready={ready} />
            ) : (
              <EmptyState icon="pause" title={t().nothingReady} description={t().nothingReadyHint} />
            )}
          </Tab>
          <Tab value="epics" label={`${t().epics} (${answer.beads.filter((b) => b.issue_type === 'epic').length})`}>
            <EpicsTab beads={answer.beads} ready={ready} />
          </Tab>
        </Tabs>
      )}
    </Stack>
  )
}

const KNOWN_LINKS = ['parent-child', 'blocks', 'duplicates', 'supersedes']

/** Links split by direction and kind, in the order a person reads them. */
function linkGroups(b: BeadDetail): [string, BeadLink[]][] {
  const deps = b.dependencies ?? []
  const dents = b.dependents ?? []
  const m = t()
  const groups: [string, BeadLink[]][] = [
    [m.parent, deps.filter((l) => l.dependency_type === 'parent-child')],
    [m.children, dents.filter((l) => l.dependency_type === 'parent-child')],
    [m.blocks, dents.filter((l) => l.dependency_type === 'blocks')],
    [m.duplicateOf, deps.filter((l) => l.dependency_type === 'duplicates')],
    [m.supersededBy, deps.filter((l) => l.dependency_type === 'supersedes')],
    [m.duplicates, dents.filter((l) => l.dependency_type === 'duplicates')],
    [m.replaces, dents.filter((l) => l.dependency_type === 'supersedes')],
    [m.related, [...deps, ...dents].filter((l) => !KNOWN_LINKS.includes(l.dependency_type))]
  ]
  return groups.filter(([, links]) => links.length > 0)
}

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(env.locale, { dateStyle: 'medium', timeStyle: 'short' }) : null

function DetailView({ id, answer }: { id: string; answer: ShowAnswer | null }) {
  const b = answer?.bead
  const status = b && statusOf(b.status)
  const texts = b
    ? ([
        [t().design, b.design],
        [t().acceptance, b.acceptance_criteria],
        [t().notes, b.notes]
      ].filter(([, text]) => text) as [string, string][])
    : []
  return (
    <Stack gap="lg">
      {answer === null ? (
        <TitleRow title={null} onClose={back}>
          <Skeleton lines={4} label={t().loadingBead(id)} />
        </TitleRow>
      ) : !b ? (
        <TitleRow title={null} onClose={back}>
          <ProblemState problem={answer.problem ?? 'not-found'} error={answer.error} id={id} />
        </TitleRow>
      ) : (
        <Stack gap="lg">
          <Stack gap="sm">
            <TitleRow title={b.title} level={1} onClose={back} onEdit={() => openEdit(b)} />
            <Row gap="xs" wrap>
              <Badge tone={status!.tone}>{status!.label}</Badge>
              {/* P0 and P1 are the one fact that should jump out. */}
              <Badge
                tone={b.priority === 0 ? 'danger' : b.priority === 1 ? 'warning' : 'neutral'}
              >{`P${b.priority}`}</Badge>
              {b.issue_type && <Badge>{t().types[b.issue_type] ?? b.issue_type}</Badge>}
              {(b.labels ?? []).map((l) => (
                <Badge>{l}</Badge>
              ))}
            </Row>
          </Stack>
          <Actions b={b} />
          <Stack gap="sm">
            <Collapsible title={t().description} defaultOpen>
              {b.description ? (
                <Markdown content={flat(b.description)} />
              ) : (
                <Text muted size="sm">
                  {t().noDescription}
                </Text>
              )}
            </Collapsible>
            {texts.map(([title, text]) => (
              <Collapsible title={title} defaultOpen={false}>
                <Markdown content={flat(text)} />
              </Collapsible>
            ))}
            <Blockers b={b} />
            {linkGroups(b).map(([label, links]) => (
              <Collapsible title={`${label} (${links.length})`} defaultOpen={false}>
                <List label={label}>
                  {links.map((l) => (
                    <ListItem
                      title={l.title}
                      description={`${l.id} · ${statusOf(l.status).label}`}
                      icon={iconOf(l, null)}
                      onPress={() => open(l.id)}
                    />
                  ))}
                </List>
              </Collapsible>
            ))}
            <Comments b={b} />
            <Collapsible title={t().properties} defaultOpen={false}>
              <Stack gap="sm">
                <Fields b={b} />
                <KeyValue
                  items={[
                    { label: 'ID', value: b.id },
                    { label: t().created, value: when(b.created_at) },
                    { label: t().updated, value: when(b.updated_at) },
                    { label: t().closedAt, value: when(b.closed_at) },
                    { label: t().closeReason, value: b.close_reason ?? null }
                  ].filter((item) => item.value)}
                />
              </Stack>
            </Collapsible>
          </Stack>
        </Stack>
      )}
    </Stack>
  )
}

const priorities = () => t().priorities.map((label, i) => ({ value: String(i), label }))
/** bd types offered when creating; the worker accepts the same list. */
const types = () => ['task', 'bug', 'feature', 'epic', 'chore'].map((value) => ({ value, label: t().types[value] }))

/** The last write's result: a quiet success line, or a short failure with bd's words folded away. */
function Outcome() {
  const o = read(outcome)
  if (!o) return null
  if (!o.problem)
    return o.notice ? (
      <Text tone="success" size="sm">
        {o.notice}
      </Text>
    ) : null
  return (
    <Stack gap="xs">
      <Text tone="danger" size="sm">
        {o.problem === 'no-workspace'
          ? t().noWorkspaceShort
          : /blocked by/i.test(o.error ?? '')
            ? t().stillBlocked
            : t().actionFailed}
      </Text>
      {o.error && (
        <Collapsible title={t().details} defaultOpen={false}>
          <CodeView code={o.error} wrap label={t().message} />
        </Collapsible>
      )}
    </Stack>
  )
}

function Actions({ b }: { b: BeadDetail }) {
  const isBusy = read(busy)
  const c = read(closing)
  const closed = b.status === 'closed'
  const doing = isDoing(b)
  // An agent launched here has not claimed the task yet: say so, and make starting another one deliberate.
  const startedBy = !closed && !doing ? read(launched)[b.id] : undefined
  if (read(releasing) === b.id)
    return (
      <Stack gap="sm">
        <Text size="sm">{t().releaseConfirm(b.assignee ?? t().holder)}</Text>
        <Row gap="xs">
          <Button variant="solid" tone="warning" disabled={isBusy} onPress={() => confirmRelease(b.id)}>
            {t().release}
          </Button>
          <Button variant="ghost" onPress={() => set(releasing, null)}>
            {t().cancel}
          </Button>
        </Row>
        <Outcome />
      </Stack>
    )
  if (c !== null) {
    // Any other task can be the canonical one or the replacement.
    const others = (read(list)?.beads ?? []).filter((o) => o.id !== b.id)
    const needsOther = c.how !== 'done'
    return (
      <Stack gap="sm">
        <Select
          label={t().closeHow}
          value={c.how}
          options={[
            { value: 'done', label: t().closeDone },
            { value: 'duplicate', label: t().closeDuplicate },
            { value: 'supersede', label: t().closeSupersede }
          ]}
          onChange={(how) => set(closing, { ...c, how: how as typeof c.how })}
        />
        {needsOther ? (
          <Select
            label={t().closeOther}
            value={c.other || NONE}
            options={[{ value: NONE, label: t().pickTask }, ...others.map((o) => ({ value: o.id, label: o.title }))]}
            onChange={(v) => set(closing, { ...c, other: v === NONE ? '' : v })}
          />
        ) : (
          <Input
            label={t().closeReasonLabel}
            value={c.reason}
            placeholder={t().closeReasonPlaceholder}
            onChange={(reason) => set(closing, { ...c, reason })}
            onSubmit={() => confirmClose(b.id)}
          />
        )}
        <Row gap="xs">
          <Button
            variant="solid"
            tone="accent"
            icon="check"
            disabled={isBusy || (needsOther && !c.other)}
            onPress={() => confirmClose(b.id)}
          >
            {t().closeBead}
          </Button>
          <Button variant="ghost" onPress={() => set(closing, null)}>
            {t().cancel}
          </Button>
        </Row>
        <Outcome />
      </Stack>
    )
  }
  return (
    <Stack gap="sm">
      <Row gap="xs" wrap>
        {!closed && !doing && (
          <Button
            variant={startedBy ? 'outline' : 'solid'}
            tone={startedBy ? undefined : 'accent'}
            icon="play"
            disabled={isBusy}
            // Starting a task means handing it to an agent; the agent claims it.
            onPress={() => openLaunch(b)}
          >
            {startedBy ? t().startAgain : t().start}
          </Button>
        )}
        {!closed && (
          // Agents usually close their own tasks: finishing by hand stays a secondary action.
          <Button
            variant="outline"
            icon="check"
            disabled={isBusy}
            onPress={() => set(closing, { how: 'done', reason: '', other: '' })}
          >
            {t().finish}
          </Button>
        )}
        {doing && (
          // Takes the task back from whoever holds it, a crashed agent included; confirmed first.
          <Button variant="ghost" disabled={isBusy} onPress={() => set(releasing, b.id)}>
            {t().release}
          </Button>
        )}
        {closed && (
          <Button
            variant="outline"
            icon="refresh"
            disabled={isBusy}
            onPress={() => act({ id: b.id, action: 'reopen' }, t().reopened)}
          >
            {t().reopen}
          </Button>
        )}
        {b.issue_type === 'epic' && (
          <Button variant="ghost" icon="add" disabled={isBusy} onPress={() => openCreate(b)}>
            {t().subtask}
          </Button>
        )}
      </Row>
      {startedBy && !read(outcome) && (
        <Text muted size="sm">
          {t().agentStarted(startedBy)}
        </Text>
      )}
      <Outcome />
    </Stack>
  )
}

/** The thread, oldest first, then a box to add to it. */
function Comments({ b }: { b: BeadDetail }) {
  const comments = b.comments ?? []
  const text = read(comment)
  return (
    <Collapsible title={comments.length ? `${t().comments} (${comments.length})` : t().comments} defaultOpen={false}>
      <Stack gap="lg">
        {comments.length > 0 && (
          <Stack gap="md">
            {comments.map((c) => (
              <Stack gap="xs">
                <Text muted size="xs">
                  {c.author} · <RelativeTime at={Date.parse(c.created_at)} muted />
                </Text>
                <Markdown content={flat(c.text)} />
              </Stack>
            ))}
          </Stack>
        )}
        <Stack gap="sm">
          <Textarea
            label={t().addComment}
            labelHidden
            rows={3}
            value={text}
            placeholder={t().addCommentPlaceholder}
            onChange={(v) => set(comment, v)}
            onSubmit={() => addComment(b.id)}
          />
          <Row>
            <Button variant="outline" size="sm" disabled={read(busy) || !text.trim()} onPress={() => addComment(b.id)}>
              {t().postComment}
            </Button>
          </Row>
        </Stack>
      </Stack>
    </Collapsible>
  )
}

function Blockers({ b }: { b: BeadDetail }) {
  const isBusy = read(busy)
  const blockers = (b.dependencies ?? []).filter((l) => l.dependency_type === 'blocks')
  // A task can wait on any other unfinished task it does not already wait on.
  const candidates = (read(list)?.beads ?? []).filter(
    (o) => o.id !== b.id && o.status !== 'closed' && !blockers.some((l) => l.id === o.id)
  )
  // Always shown, even empty: it is also where a blocker gets added.
  return (
    <Collapsible title={blockers.length ? `${t().blockedBy} (${blockers.length})` : t().blockedBy} defaultOpen={false}>
      <Stack gap="xs">
        {blockers.length === 0 && (
          <Text muted size="sm">
            {t().noBlockers}
          </Text>
        )}
        {blockers.map((l) => (
          // The row opens the blocker; the × beside it removes the blocker.
          <Row align="center" gap="xs">
            <Box grow shrink>
              <List label={l.title}>
                <ListItem
                  title={l.title}
                  description={`${l.id} · ${statusOf(l.status).label}`}
                  icon={iconOf(l, null)}
                  onPress={() => open(l.id)}
                />
              </List>
            </Box>
            <IconButton
              icon="close"
              label={t().removeBlocker(l.title)}
              tooltip={t().removeBlocker(l.title)}
              variant="ghost"
              size="sm"
              disabled={isBusy}
              onPress={() => act({ id: b.id, action: 'unblock', other: l.id }, t().blockerRemoved)}
            />
          </Row>
        ))}
        {candidates.length > 0 && (
          <Select
            label={t().addBlocker}
            labelHidden
            value={NONE}
            options={[
              { value: NONE, label: t().addBlocker },
              ...candidates.map((o) => ({ value: o.id, label: o.title }))
            ]}
            disabled={isBusy}
            onChange={(v) => v !== NONE && act({ id: b.id, action: 'block', other: v }, t().blockerAdded)}
          />
        )}
      </Stack>
    </Collapsible>
  )
}

function Fields({ b }: { b: BeadDetail }) {
  const isBusy = read(busy)
  return (
    <Stack gap="md">
      <Select
        label={t().priority}
        value={String(b.priority)}
        options={priorities()}
        disabled={isBusy}
        onChange={(v) => act({ id: b.id, action: 'priority', priority: Number(v) }, t().priorityChanged)}
      />
      <Row justify="between" align="center">
        <Text size="sm">{b.assignee ? t().assignedTo(b.assignee) : t().unassigned}</Text>
        {b.assignee ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onPress={() => act({ id: b.id, action: 'unassign' }, t().unassignedDone)}
          >
            {t().unassign}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onPress={() => act({ id: b.id, action: 'assign-me' }, t().assigned)}
          >
            {t().assignMe}
          </Button>
        )}
      </Row>
    </Stack>
  )
}

/** A title with a close (×) at its right, which goes back; Orca has no back-arrow icon. */
function TitleRow({
  title,
  level = 2,
  onClose,
  onEdit,
  children
}: {
  title: string | null
  level?: 1 | 2
  onClose: () => void
  onEdit?: () => void
  children?: unknown
}) {
  return (
    <Row justify="between" align="start" gap="sm">
      {title === null ? <Box grow>{children}</Box> : <Heading level={level}>{title}</Heading>}
      <Row gap="xs">
        {onEdit && <IconButton icon="edit" label={t().edit} tooltip={t().edit} variant="ghost" onPress={onEdit} />}
        <IconButton icon="close" label={t().back} tooltip={t().back} variant="ghost" onPress={onClose} />
      </Row>
    </Row>
  )
}

function FormHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <Stack gap="xs">
      <TitleRow title={title} onClose={closeForm} />
      {sub && (
        <Text muted size="sm">
          {sub}
        </Text>
      )}
    </Stack>
  )
}

function EditView({ bead }: { bead: Ref }) {
  const d = read(editDraft)
  const field = (key: keyof typeof d) => (v: string) => set(editDraft, { ...read(editDraft), [key]: v })
  return (
    <Stack gap="lg">
      <FormHeader title={t().editTitle} sub={bead.id} />
      <Input label={t().title} value={d.title} onChange={field('title')} onSubmit={() => submitEdit(bead.id)} />
      <Select label={t().type} value={d.type} options={types()} onChange={field('type')} />
      <Textarea label={t().description} rows={5} value={d.description} onChange={field('description')} />
      <Textarea label={t().acceptance} rows={3} value={d.acceptance} onChange={field('acceptance')} />
      {/* Rarely filled: folded unless the task already has some. */}
      <Collapsible title={t().designAndNotes} defaultOpen={Boolean(d.design || d.notes)}>
        <Stack gap="md">
          <Textarea label={t().design} rows={3} value={d.design} onChange={field('design')} />
          <Textarea label={t().notes} rows={3} value={d.notes} onChange={field('notes')} />
        </Stack>
      </Collapsible>
      <Row gap="xs">
        <Button
          variant="solid"
          tone="accent"
          icon="check"
          disabled={read(busy) || !d.title.trim()}
          onPress={() => submitEdit(bead.id)}
        >
          {t().save}
        </Button>
        <Button variant="ghost" onPress={closeForm}>
          {t().cancel}
        </Button>
      </Row>
      <Outcome />
    </Stack>
  )
}

const NO_EPIC = NONE

function CreateView() {
  const d = read(draft)
  // Open epics a new task can join; none to pick from means no picker.
  const epics = (read(list)?.beads ?? []).filter((b) => b.issue_type === 'epic' && b.status !== 'closed')
  const canStart = d.type !== 'epic'
  return (
    <Stack gap="lg">
      <FormHeader title={d.parent ? t().newSubtask : t().newBead} />
      <Input
        label={t().title}
        value={d.title}
        placeholder={t().titlePlaceholder}
        onChange={(title) => set(draft, { ...read(draft), title })}
        onSubmit={() => submitCreate()}
      />
      <Textarea
        label={t().description}
        rows={3}
        value={d.description ?? ''}
        placeholder={t().descriptionPlaceholder}
        onChange={(description) => set(draft, { ...read(draft), description })}
      />
      {/* Two short choices share a row, so the form stays within one screen. */}
      <Row gap="sm">
        <Box grow>
          <Select
            label={t().type}
            value={d.type}
            options={types()}
            onChange={(type) => set(draft, { ...read(draft), type })}
          />
        </Box>
        <Box grow>
          <Select
            label={t().priority}
            value={d.priority}
            options={priorities()}
            onChange={(priority) => set(draft, { ...read(draft), priority })}
          />
        </Box>
      </Row>
      {epics.length > 0 && d.type !== 'epic' && (
        <Select
          label={t().epic}
          // Orca's Select refuses an empty value, so "no epic" has its own.
          value={d.parent || NO_EPIC}
          options={[{ value: NO_EPIC, label: t().noEpic }, ...epics.map((e) => ({ value: e.id, label: e.title }))]}
          onChange={(v) => set(draft, { ...read(draft), parent: v === NO_EPIC ? '' : v })}
        />
      )}
      <Row gap="xs" wrap>
        <Button
          variant="solid"
          tone="accent"
          icon="add"
          disabled={read(busy) || !d.title.trim()}
          onPress={() => submitCreate()}
        >
          {t().create}
        </Button>
        {canStart && (
          <Button
            variant="outline"
            icon="play"
            disabled={read(busy) || !d.title.trim()}
            onPress={() => submitCreate(true)}
          >
            {t().createAndStart}
          </Button>
        )}
        <Button variant="ghost" onPress={closeForm}>
          {t().cancel}
        </Button>
      </Row>
      <Outcome />
    </Stack>
  )
}

function LaunchView({ bead }: { bead: Ref }) {
  const l = read(launch)
  const ts = read(targets)
  const isNew = l.target === 'new'
  const places = [
    ...(ts?.workspaces ?? []).map((w, i) => ({ value: w.id, label: i === 0 ? t().thisWorktree(w.name) : w.name })),
    { value: 'new', label: t().newWorktree }
  ]
  const agents = (ts?.agents ?? []).map((a) => ({ value: a.id, label: a.name }))
  return (
    <Stack gap="lg">
      <FormHeader title={t().launchTitle} sub={`${bead.title} · ${bead.id}`} />
      {ts === null ? (
        <Skeleton lines={3} label={t().loadingTargets} />
      ) : agents.length === 0 ? (
        <EmptyState icon="agent" title={t().noAgents} description={t().noAgentsHint} />
      ) : (
        <Stack gap="md">
          <Select
            label={t().agent}
            value={l.agent}
            options={agents}
            onChange={(agent) => set(launch, { ...read(launch), agent })}
          />
          <Select
            label={t().where}
            value={l.target}
            options={places}
            onChange={(target) => set(launch, { ...read(launch), target })}
          />
        </Stack>
      )}
      {isNew && (
        <Input label={t().worktreeName} value={l.name} onChange={(name) => set(launch, { ...read(launch), name })} />
      )}
      <Textarea
        label={t().prompt}
        rows={3}
        value={l.prompt}
        onChange={(prompt) => set(launch, { ...read(launch), prompt })}
      />
      <Row gap="xs">
        <Button
          variant="solid"
          tone="accent"
          icon="agent"
          disabled={read(busy) || !l.agent || !l.prompt.trim() || (isNew && !l.name.trim())}
          onPress={submitLaunch}
        >
          {isNew ? t().createAndLaunch : t().launch}
        </Button>
        <Button variant="ghost" onPress={closeForm}>
          {t().cancel}
        </Button>
      </Row>
      <Outcome />
    </Stack>
  )
}

const problems = (): Record<
  BeadsProblem,
  { icon: 'folder' | 'layers' | 'wrench' | 'search' | 'warning'; title: string; hint: string; command?: string }
> => {
  const m = t()
  return {
    'no-workspace': { icon: 'folder', title: m.noWorkspace, hint: m.noWorkspaceHint },
    'no-database': { icon: 'layers', title: m.noDatabase, hint: m.noDatabaseHint, command: 'bd init' },
    'no-bd': { icon: 'wrench', title: m.noBd, hint: m.noBdHint, command: 'brew install beads' },
    'not-found': { icon: 'search', title: m.notFound, hint: m.notFoundHint },
    failed: { icon: 'warning', title: m.failed, hint: m.failedHint }
  }
}

/** A friendly empty state; bd's raw words stay one click away for whoever wants them. */
function ProblemState({ problem, error, id }: { problem: BeadsProblem; error?: string; id?: string }) {
  const p = problems()[problem]
  return (
    <Stack gap="md">
      <EmptyState icon={p.icon} title={p.title} description={id ? `${id} · ${p.hint}` : p.hint}>
        <Stack gap="sm" align="center">
          {p.command && <Code>{p.command}</Code>}
          <Button variant="outline" size="sm" icon="refresh" onPress={refresh}>
            {t().retry}
          </Button>
        </Stack>
      </EmptyState>
      {error && (
        <Collapsible title={t().details} defaultOpen={false}>
          <CodeView code={error} wrap label={t().bdMessage} />
        </Collapsible>
      )}
    </Stack>
  )
}

export default function Panel() {
  const answer = read(list)
  const id = read(openId)
  const f = read(form)
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading>Beads</Heading>
        <Row gap="xs">
          {!f && answer && !answer.problem && (
            <IconButton icon="add" label={t().newBead} variant="ghost" onPress={() => openCreate(null)} />
          )}
          <IconButton icon="refresh" label={t().refresh} variant="ghost" onPress={refresh} />
        </Row>
      </Row>
      {f?.kind === 'create' ? (
        <CreateView />
      ) : f?.kind === 'edit' ? (
        <EditView bead={f.bead} />
      ) : f?.kind === 'launch' ? (
        <LaunchView bead={f.bead} />
      ) : id ? (
        <DetailView id={id} answer={read(detail)?.id === id ? read(detail)!.answer : null} />
      ) : answer === null ? (
        <Skeleton lines={6} label={t().loadingBeads} />
      ) : answer.problem ? (
        <ProblemState problem={answer.problem} error={answer.error} />
      ) : (
        <ListView answer={answer} />
      )}
    </Stack>
  )
}
