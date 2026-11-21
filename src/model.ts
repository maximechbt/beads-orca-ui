// What the panel computes from bd's answers, with no DOM: the panel page and the tests both import it.
// Types only: the frame never loads the protocol file.
import type {} from './protocol.ts'

const byUpdatedDesc = (a: Bead, b: Bead) => b.updated_at.localeCompare(a.updated_at)
/** bd's built-in types; the worker refuses any other, the panel offers these. */
export const TYPES = ['task', 'bug', 'feature', 'epic', 'chore', 'decision', 'spike', 'story', 'milestone']
/** Statuses a person sets by hand; closing goes through close, duplicate or supersede. */
export const STATUSES = ['open', 'in_progress', 'blocked', 'deferred', 'pinned']

/** `o[k]` only when `o` has `k` itself: a status or type named constructor or __proto__ reads as unknown, not as JavaScript's own. */
export const own = <T>(o: Record<string, T>, k: string): T | undefined => (Object.hasOwn(o, k) ? o[k] : undefined)

export const byPriority = (a: Bead, b: Bead) => a.priority - b.priority || a.id.localeCompare(b.id)
export type Category = 'active' | 'wip' | 'done' | 'frozen'

/** bd's built-in statuses, by category, as `bd statuses` lists them. */
const BUILT_IN: Record<string, Category> = { open: 'active', in_progress: 'wip', blocked: 'wip', hooked: 'wip', deferred: 'frozen', pinned: 'frozen', closed: 'done' }

/** The statuses this workspace adds with `bd config set status.custom`. */
let custom = new Map<string, Category>()

/** Takes the workspace's custom statuses, as the worker read them from `bd statuses`. */
export function useCustomStatuses(list: { name: string; category: string }[] = []) {
  custom = new Map(list.filter((s) => !Object.hasOwn(BUILT_IN, s.name)).map((s) => [s.name, s.category as Category]))
}

/** The custom statuses a person can set, in the order bd lists them. */
export const customStatuses = () => [...custom.keys()]

export const isCustom = (status: string) => custom.has(status)

/** The types this workspace adds with `bd config set types.custom`. */
let customTypes: string[] = []
export function useCustomTypes(list: string[] = []) {
  customTypes = list.filter((ty) => !TYPES.includes(ty))
}
/** Every type a person can pick: bd's own, then the workspace's. */
export const allTypes = () => [...TYPES, ...customTypes]

/** `bd set-state` keeps a dimension's value as a `dimension:value` label: health:failing → ['health', 'failing']. */
export function stateOf(label: string): [dimension: string, value: string] | null {
  const m = /^([^:\s]+):(\S+)$/.exec(label)
  return m ? [m[1], m[2]] : null
}

/** How a status behaves; one bd has not told us about reads as active, like open. */
export const categoryOf = (status: string): Category => (Object.hasOwn(BUILT_IN, status) ? BUILT_IN[status] : (custom.get(status) ?? 'active'))

/** Moving: in progress, hooked by an agent, or a custom work-in-progress status like a review. */
export const isDoing = (b: { status: string }) => b.status !== 'blocked' && categoryOf(b.status) === 'wip'

/** Finished: closed, or a custom done status like shipped. */
export const isDone = (b: { status: string }) => categoryOf(b.status) === 'done'

/** Current = the most recently touched in-progress bead; the rest split into todo / in progress / done. */
export function group(beads: Bead[]) {
  // An epic in progress is a container, never the task someone is doing.
  const doing = beads.filter((b) => isDoing(b) && b.issue_type !== 'epic').sort(byUpdatedDesc)
  return {
    current: doing[0] ?? null,
    inProgress: doing.slice(1),
    todo: beads.filter((b) => !isDone(b) && !isDoing(b)).sort(byPriority),
    done: beads.filter(isDone).sort(byUpdatedDesc)
  }
}

/** Waiting on something: bd says blocked, or it is open (or a custom active status) and `bd ready` leaves it out. */
const isWaiting = (b: Bead, ready: Set<string>) => b.status === 'blocked' || (categoryOf(b.status) === 'active' && !ready.has(b.id))

/** The All tab's groups: what moves, what can start, what waits, what is done, and one per custom status. */
export type SectionKey = 'doing' | 'todo' | 'blocked' | 'done' | (string & {})

const customsOf = (category: Category) => customStatuses().filter((s) => custom.get(s) === category)

/**
 * The groups in order, each custom status beside its category's: a review after In progress, QA after Todo,
 * parked after Waiting, shipped before Done. `workOrder` puts Todo first, as the board reads left to right.
 */
export function sectionKeys(workOrder = false): SectionKey[] {
  const doing = ['doing', ...customsOf('wip')]
  const todo = ['todo', ...customsOf('active')]
  return [...(workOrder ? [...todo, ...doing] : [...doing, ...todo]), 'blocked', ...customsOf('frozen'), ...customsOf('done'), 'done']
}

export function sections(beads: Bead[], ready: Set<string>, workOrder = false): [SectionKey, Bead[]][] {
  const by = new Map(sectionKeys(workOrder).map((k): [SectionKey, Bead[]] => [k, []]))
  // Epics in progress included: All lists everything.
  for (const b of beads) by.get(sectionOf(b, ready))?.push(b)
  // What moves and what is done, latest first; what is still to do, by priority.
  const latestFirst = (k: SectionKey) => k === 'doing' || k === 'done' || (isCustom(k) && (categoryOf(k) === 'wip' || categoryOf(k) === 'done'))
  for (const [k, list] of by) list.sort(latestFirst(k) ? byUpdatedDesc : byPriority)
  return [...by]
}

/**
 * The board's columns in the order a person chose: the saved ones first as saved, then any column the order
 * does not know (a status added since) right after the column it follows by default.
 */
export function orderColumns(keys: SectionKey[], saved: string[]): SectionKey[] {
  const out = saved.filter((k) => keys.includes(k))
  keys.forEach((k, i) => {
    if (out.includes(k)) return
    const before = keys.slice(0, i).reverse().find((p) => out.includes(p))
    out.splice(before === undefined ? 0 : out.indexOf(before) + 1, 0, k)
  })
  return out
}

/** Moves column `from` to where `to` is: past it when it came from the left, before it from the right. */
export function moveColumn(order: SectionKey[], from: SectionKey, to: SectionKey): SectionKey[] {
  const out = order.filter((k) => k !== from)
  out.splice(order.indexOf(to), 0, from)
  return out
}

/** The group `sections` puts one bead in: its own for a custom status. */
export const sectionOf = (b: Bead, ready: Set<string>): SectionKey =>
  isCustom(b.status) ? b.status : isDoing(b) ? 'doing' : isDone(b) ? 'done' : isWaiting(b, ready) ? 'blocked' : 'todo'

/** A query as the lowercase words a match must all contain. */
export const queryWords = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)
/** What a query is matched against: title and id, lowercase. */
export const searchText = (b: Bead) => `${b.title} ${b.id}`.toLowerCase()
/** Title or id contains every word of the query, any case. */
export const matches = (b: Bead, q: string) => queryWords(q).every((word) => searchText(b).includes(word))

/** Work order: what is moving, then what is open by priority, then what is done. */
const rank = (b: Bead) => (isDoing(b) ? 0 : isDone(b) ? 2 : 1)
export const byWorkOrder = (a: Bead, b: Bead) => rank(a) - rank(b) || byPriority(a, b)

/** The nearest epic above a bead, or null; a parent cycle must not loop forever. */
export function epicOf(b: Bead, byId: Map<string, Bead>): Bead | null {
  const seen = new Set<string>()
  let p = b.parent ? byId.get(b.parent) : undefined
  while (p && !seen.has(p.id)) {
    if (p.issue_type === 'epic') return p
    seen.add(p.id)
    p = p.parent ? byId.get(p.parent) : undefined
  }
  return null
}

/** Each bead under its nearest epic ancestor; beads with none are `loose`. */
export function byEpic(beads: Bead[]) {
  const byId = new Map(beads.map((b) => [b.id, b]))
  const children = new Map<string, Bead[]>()
  const loose: Bead[] = []
  for (const b of beads) {
    if (b.issue_type === 'epic') continue
    const epic = epicOf(b, byId)
    if (epic) children.set(epic.id, [...(children.get(epic.id) ?? []), b])
    else loose.push(b)
  }
  const epics = beads
    .filter((b) => b.issue_type === 'epic')
    .sort(byWorkOrder)
    .map((epic) => {
      const kids = (children.get(epic.id) ?? []).sort(byWorkOrder)
      return { epic, children: kids, done: kids.filter(isDone).length }
    })
  return { epics, loose: loose.sort(byWorkOrder) }
}

/** The id prefix every bead shares (`demo-`), so rows can show only what tells them apart. */
export function commonPrefix(ids: string[]) {
  if (ids.length < 2) return ''
  let p = ids[0]
  for (const id of ids) while (!id.startsWith(p)) p = p.slice(0, -1)
  // Cut after the last separator, never inside a word: `demo-ck` and `demo-cl` share `demo-`.
  const cut = Math.max(p.lastIndexOf('-'), p.lastIndexOf('_'))
  return cut >= 0 ? p.slice(0, cut + 1) : ''
}

/** Headings inside a task's text become bold lines, so they never outrank the panel's own sections. */
export const flat = (md: string) => md.replace(/^#{1,6}[ \t]+(.+?)[ \t#]*$/gm, '**$1**')

/** Up to two letters for an avatar: "Ada Lovelace" → "AL", "claude" → "CL". */
export function initials(name: string) {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/** A stable hue for a name or id, so an epic or a person keeps the same colour everywhere. */
export function hue(text: string) {
  let h = 0
  for (const c of text) h = (h * 31 + c.codePointAt(0)!) % 360
  return h
}

/** 90 → "1 h 30", 480 → "8 h"; a person reads hours, bd stores minutes. */
export function minutes(n: number) {
  const hh = Math.floor(n / 60)
  const mm = n % 60
  return hh ? `${hh} h${mm ? ` ${String(mm).padStart(2, '0')}` : ''}` : `${mm} min`
}

/** "90", "90m", "1h30", "2h", "1d" (a working day, 8 h) → minutes; null when it reads as none of these. */
export function parseMinutes(q: string): number | null {
  const s = q.trim().toLowerCase().replace(/\s+/g, '')
  const m = s.match(/^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)(?:m|min)?)?$/)
  if (!s || !m) return null
  const total = Number(m[1] ?? 0) * 480 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  return total > 0 && total < 1e6 ? total : null
}

/** How far back closed tasks load: a week, then a month, a quarter, all (0). */
export const CLOSED_WINDOWS = [7, 30, 90, 0]
/** The day closed tasks are loaded from, `days` back; null loads them all. */
export const closedSince = (days: number, now = Date.now()) => (days > 0 ? new Date(now - days * 86_400_000).toISOString().slice(0, 10) : null)
/** The window after `days`: what "show older" loads next; null once everything shows. */
export const widerWindow = (days: number) => (days === 0 ? null : (CLOSED_WINDOWS.find((d) => d === 0 || d > days) ?? 0))
