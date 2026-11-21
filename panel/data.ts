// Reading from bd and writing to it, and what the views look up in the list it answered.
import { closedSince, queryWords, searchText, epicOf, commonPrefix, useCustomStatuses, useCustomTypes, widerWindow } from '../src/model.ts'
import { applyToDetail, applyToList, isTemp, newDetail } from '../src/optimistic.ts'
import type { Context, NewTask, Write } from '../src/optimistic.ts'
import { request } from './bridge.ts'
import { render } from './render.ts'
import { save, state, storeList, t, useWorkspace } from './state.ts'
import type { PluginRequestInput } from 'orca'
import type { Detail, ListAnswer, ShowAnswer } from './state.ts'

async function refreshList() {
  try {
    // The version held lets the worker answer "unchanged" instead of sending every task again.
    const held = state.list && !state.list.problem ? state.list.version : undefined
    const answer = await request('beads.list', { closedDays: state.ui.closedDays, ...(held ? { since: held } : {}) })
    const switched = useWorkspace(answer.workspace ?? null)
    state.loadedAt = Date.now()
    // Same list: keep the same object, so nothing derived from it is computed again.
    if (answer.unchanged && !switched && state.list) return
    state.list = answer
    storeList()
    // A task bd changed since it was read ahead is read again when needed.
    const now = new Map(answer.beads.map((b) => [b.id, b.updated_at]))
    for (const [id, d] of details) if (now.get(id) !== d.bead?.updated_at) details.delete(id)
    if (switched && state.ui.openId) void loadDetail(state.ui.openId)
    if (switched && state.ui.form?.kind === 'launch') void loadTargets()
  } catch (err) {
    state.list = { workspace: null, beads: [], ready: [], problem: 'failed', error: (err as Error).message }
  }
}

export async function loadMemories() {
  try {
    state.memories = await request('beads.memories')
  } catch (err) {
    state.memories = { memories: [], problem: 'failed', error: (err as Error).message }
  }
  render()
}

/** Replaces the memories shown, before bd confirms; a failure reads them back from bd. */
function showMemories(change: (list: { key: string; value: string }[]) => { key: string; value: string }[]) {
  if (state.memories && !state.memories.problem) state.memories = { ...state.memories, memories: change(state.memories.memories) }
}

/** Sends a memory write; on failure the editor comes back as it was and bd's list is read again. */
async function memoryWrite(input: PluginRequestInput<'beads.memory'>, notice: string, undo: () => void) {
  let r: ActResult
  try {
    r = await request('beads.memory', input)
  } catch (err) {
    r = { ok: false, problem: 'failed', error: (err as Error).message }
  }
  state.outcome = r.ok ? { notice } : { problem: r.problem ?? 'failed', error: r.error }
  if (!r.ok) undo()
  await loadMemories()
}

export async function saveMemory() {
  const e = state.memEdit
  if (!e || !e.value.trim()) return
  const key = e.key ?? e.newKey.trim()
  // A new memory without a key gets one from bd; until then it shows under a blank key.
  showMemories((list) => [...list.filter((x) => x.key !== key || !key), { key: key || '…', value: e.value.trim() }].sort((a, b) => a.key.localeCompare(b.key)))
  state.memEdit = null
  render()
  await memoryWrite({ action: 'remember', value: e.value, ...(key ? { key } : {}) }, t().memorySaved, () => (state.memEdit = e))
}

export async function forgetMemory(key: string) {
  showMemories((list) => list.filter((x) => x.key !== key))
  state.forgetting = null
  render()
  await memoryWrite({ action: 'forget', key }, t().memoryForgotten, () => {})
}

// Tasks read ahead of a click (hover, focus, the keyboard cursor), so opening one shows it at once.
// shortcut: keeps the 100 most recently read tasks; raise it if people jump between more.
export const details = new Map<string, ShowAnswer>()

const reading = new Map<string, Promise<ShowAnswer>>()

const keep = (id: string, answer: ShowAnswer) => {
  if (!answer.bead) return
  details.delete(id)
  details.set(id, answer)
  if (details.size > 100) details.delete(details.keys().next().value!)
}

/** One `bd show` per task at a time: a hover and then a click share the same read. */
function read(id: string): Promise<ShowAnswer> {
  let p = reading.get(id)
  if (!p) {
    p = request('beads.show', { id })
      .then((answer) => (keep(id, answer), answer))
      .finally(() => reading.delete(id))
    reading.set(id, p)
  }
  return p
}

/** Reads a task ahead unless it is known and unchanged, or another read or a reload is under way. */
// The worker runs bd one call at a time: a read ahead waits its turn behind a reload, and a click waits behind it.
export function prefetch(id: string) {
  if (details.has(id) || reading.has(id) || reading.size >= 1 || state.reloading > 0) return
  read(id).catch(() => {})
}

export async function loadDetail(id: string) {
  try {
    const answer = await read(id)
    if (state.ui.openId === id) state.detail = { id, answer } // a later click wins
  } catch (err) {
    if (state.ui.openId === id) state.detail = { id, answer: { bead: null, problem: 'failed', error: (err as Error).message } }
  }
  render()
}

/** A refresh asked for while one runs waits for it, then runs once: agents can change state many times a second. */
let refreshing = false

let refreshAgain = false

export function refresh() {
  if (refreshing) {
    refreshAgain = true
    return
  }
  refreshing = true
  const call = ++refreshCalls
  const id = state.ui.openId
  state.reloading++
  render()
  Promise.all([refreshList(), id ? loadDetail(id) : null, state.ui.memory ? loadMemories() : null]).finally(() => {
    state.reloading--
    refreshing = false
    settle(call)
    render()
    save()
    if (refreshAgain) {
      refreshAgain = false
      refresh()
    }
  })
}

// ---------- optimistic writes ----------
// A write shows the moment it is made: it is kept apart from bd's answers and laid on top of them,
// until the reload that follows bd's confirmation brings the same change back from bd.

type InFlight = { write: Write; settledAt?: number }

const inFlight: InFlight[] = []
/** Bumped when the writes in flight change, so what is drawn from them is computed again. */
let flightVersion = 0
let refreshCalls = 0
let temps = 0
/** Tasks being created: their temporary id, and the real one bd will give (null if it refuses). */
const creating = new Map<string, Promise<string | null>>()

const changed = () => flightVersion++

/** Writes bd confirmed before this reload started come back in its answer: they are no longer laid on. */
function settle(call: number) {
  const before = inFlight.length
  for (let i = inFlight.length - 1; i >= 0; i--) if (inFlight[i].settledAt !== undefined && inFlight[i].settledAt! < call) inFlight.splice(i, 1)
  if (inFlight.length !== before) changed()
}

function context(base: ListAnswer | null): Context {
  const byId = new Map((base?.beads ?? []).map((b) => [b.id, b]))
  return { me: base?.me, now: new Date(), find: (id) => byId.get(id) }
}

let listMemo: { base: ListAnswer | null; version: number; shown: ListAnswer | null } = { base: null, version: -1, shown: null }

/** The list as drawn: bd's answer with the writes in flight laid on. */
export function shownList(): ListAnswer | null {
  const base = state.list
  if (!base || base.problem || !inFlight.length) return base
  if (listMemo.base !== base || listMemo.version !== flightVersion)
    listMemo = { base, version: flightVersion, shown: applyToList(base, inFlight.map((f) => f.write), context(base)) }
  return listMemo.shown
}

let detailMemo: { base: Detail | null; version: number; shown: Detail | null } = { base: null, version: -1, shown: null }

/** The open task as drawn; a task still being created is drawn from what was typed. */
export function shownDetail(): Detail | null {
  const id = state.ui.openId
  if (!id) return null
  const made = inFlight.find((f) => f.write.kind === 'create' && f.write.id === id)?.write
  const base = state.detail?.id === id ? state.detail : made?.kind === 'create' ? { id, answer: { bead: newDetail(made, context(state.list)) } } : null
  if (!base?.answer.bead || !inFlight.length) return base
  if (detailMemo.base !== base || detailMemo.version !== flightVersion)
    detailMemo = { base, version: flightVersion, shown: { id, answer: { ...base.answer, bead: applyToDetail(base.answer.bead, inFlight.map((f) => f.write), context(state.list)) } } }
  return detailMemo.shown
}

/** Shows a write, sends it, keeps it shown until bd's next answer has it; a refusal takes it back. */
async function optimistic<R extends ActResult>(write: Write, send: () => Promise<R>, notice?: (r: R) => string): Promise<R | null> {
  const f: InFlight = { write }
  inFlight.push(f)
  changed()
  state.outcome = null
  render()
  let r: R
  try {
    r = await send()
  } catch (err) {
    r = { ok: false, problem: 'failed', error: (err as Error).message } as R
  }
  if (r.ok) {
    f.settledAt = refreshCalls
    state.outcome = notice?.(r) ? { notice: notice(r) } : null
    refresh()
  } else {
    inFlight.splice(inFlight.indexOf(f), 1)
    changed()
    state.outcome = { problem: r.problem ?? 'failed', error: r.error }
  }
  render()
  return r.ok ? r : null
}

/** A write on a task still being created waits for its real id; it fails if the task never gets one. */
async function withRealIds(a: BeadAction): Promise<BeadAction> {
  const real = async (id?: string) => (id && isTemp(id) ? ((await creating.get(id)) ?? Promise.reject(new Error(t().actionFailed))) : id)
  return { ...a, id: (await real(a.id))!, ...(a.other ? { other: await real(a.other) } : {}) }
}

/** Changes a task: shown at once, sent to bd, taken back if bd refuses. */
export const act = (a: BeadAction, notice?: string) => optimistic({ kind: 'act', action: a }, async () => request('beads.act', await withRealIds(a)), () => notice ?? '')

/** Creates a task: it shows at once under a temporary id, then takes the id bd gives it. */
export function create(task: NewTask): { id: string; done: Promise<string | null> } {
  const temp = `~${++temps}`
  let settle!: (id: string | null) => void
  creating.set(temp, new Promise((resolve) => (settle = resolve)))
  const done = optimistic({ kind: 'create', id: temp, task }, () => request('beads.create', task)).then((r) => {
    const id = r?.id ?? null
    if (id) {
      // Everything written meanwhile now names the real task.
      for (const f of inFlight) {
        if (f.write.kind === 'create' && f.write.id === temp) f.write.id = id
        if (f.write.kind === 'act' && f.write.action.id === temp) f.write.action.id = id
        if (f.write.kind === 'act' && f.write.action.other === temp) f.write.action.other = id
      }
      changed()
    }
    creating.delete(temp)
    settle(id)
    return id
  })
  return { id: temp, done }
}

/** What the launch form can offer; a choice already made (a remembered draft) stays when still offered. */
export async function loadTargets({ quiet = false } = {}) {
  state.targets = null
  if (!quiet) render()
  try {
    const tg = await request('beads.targets')
    state.targets = { workspaces: tg.workspaces, agents: tg.agents, current: tg.current, defaultAgent: tg.defaultAgent }
    const l = state.ui.launch
    const agentOk = tg.agents.some((a) => a.id === l.agent)
    const targetOk = l.target === 'new' || tg.workspaces.some((w) => w.id === l.target)
    // Orca's default agent first; with none, the first one Orca would offer.
    l.agent = agentOk ? l.agent : (tg.defaultAgent ?? tg.agents[0]?.id ?? '')
    l.target = targetOk ? l.target : (tg.current ?? 'new')
  } catch {
    state.targets = { workspaces: [], agents: [] }
    state.ui.launch.target = 'new'
  }
  if (quiet) return
  render()
  save()
}

export const beads = () => shownList()?.beads ?? []
/** What every row looks up, computed once per answer from bd: per row it made long lists quadratic. */

let derivedFor: ListAnswer | null | undefined

let derived = { byId: new Map<string, Bead>(), ready: new Set<string>(), prefix: '', idWidth: 2, epics: new Map<string, Bead | null>(), text: new Map<string, string>() }

export function lookups() {
  const list = shownList()
  if (derivedFor === list) return derived
  const all = list?.beads ?? []
  const byIdMap = new Map(all.map((b) => [b.id, b]))
  const p = commonPrefix(all.map((b) => b.id))
  let w = 2
  for (const b of all) w = Math.max(w, b.id.length - (p && b.id.startsWith(p) ? p.length : 0))
  derivedFor = list
  // The workspace's own statuses come with its list: everything that reads a status needs them first.
  useCustomStatuses(list?.statuses)
  useCustomTypes(list?.types)
  derived = { byId: byIdMap, ready: new Set(list?.ready ?? []), prefix: p, idWidth: Math.min(w, 9), epics: new Map(), text: new Map() }
  return derived
}

export const byId = () => lookups().byId

export const readySet = () => lookups().ready

export const titleOf = (id: string) => lookups().byId.get(id)?.title ?? id

export const shortId = (id: string) => {
  const p = lookups().prefix
  return p && id.startsWith(p) && id.length > p.length ? id.slice(p.length) : id
}

/** The nearest epic above a bead, remembered for this answer. */
export function epicFor(b: Bead) {
  const d = lookups()
  if (!d.epics.has(b.id)) d.epics.set(b.id, epicOf(b, d.byId))
  return d.epics.get(b.id) ?? null
}

/** Every word of the query in the title or id, any case; the lowered text is kept per bead. */
export function search(q: string) {
  const d = lookups()
  const words = queryWords(q)
  const found = beads().filter((b) => {
    let text = d.text.get(b.id)
    if (text === undefined) d.text.set(b.id, (text = searchText(b)))
    return words.every((w) => text.includes(w))
  })
  // Closed tasks older than the loaded window that bd found for this same query.
  const older = state.olderHits?.q === q ? state.olderHits.beads.filter((b) => !d.byId.has(b.id)) : []
  return older.length ? [...found, ...older] : found
}

let olderTimer: ReturnType<typeof setTimeout> | undefined
/** Asks bd, once typing pauses, for closed tasks older than the loaded window that match `q`. */
export function searchOlder(q: string) {
  clearTimeout(olderTimer)
  const since = closedSince(state.ui.closedDays)
  if (!since || q.trim().length < 2) return void (state.olderHits = null)
  olderTimer = setTimeout(async () => {
    const answer = await request('beads.searchClosed', { q: q.trim(), before: since }).catch(() => ({ beads: [] as Bead[] }))
    if (state.ui.query.trim() !== q.trim()) return // a later query won
    state.olderHits = { q: q.trim(), beads: answer.beads }
    render()
  }, 250)
}

/** Loads the next, wider window of closed tasks: a month, a quarter, then all of them. */
export function showOlderDone() {
  const next = widerWindow(state.ui.closedDays)
  if (next === null) return
  state.ui.closedDays = next
  save()
  refresh()
}

/** An epic's progress over every child it ever had; the loaded list lacks the ones closed long ago. */
export function epicProgress(id: string, done: number, total: number) {
  return state.list?.epics?.[id] ?? { done, total }
}
