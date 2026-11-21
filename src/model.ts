// What the panel computes from bd's answers, with no DOM: the panel page and the tests both import it.
// Types only: the frame never loads the protocol file.
import type {} from './protocol.ts'

const byUpdatedDesc = (a: Bead, b: Bead) => b.updated_at.localeCompare(a.updated_at)
/** bd's built-in types; the worker refuses any other, the panel offers these. */
export const TYPES = ['task', 'bug', 'feature', 'epic', 'chore', 'decision', 'spike', 'story', 'milestone']
/** Statuses a person sets by hand; closing goes through close, duplicate or supersede. */
export const STATUSES = ['open', 'in_progress', 'blocked', 'deferred', 'pinned']

export const byPriority = (a: Bead, b: Bead) => a.priority - b.priority || a.id.localeCompare(b.id)
export const isDoing = (b: { status: string }) => b.status === 'in_progress' || b.status === 'hooked'

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

/** Waiting on something: bd says blocked, or it is open and `bd ready` leaves it out. */
const isWaiting = (b: Bead, ready: Set<string>) => b.status === 'blocked' || (b.status === 'open' && !ready.has(b.id))

/** The All tab's groups, in reading order: what moves, what can start, what waits, what is done. */
type SectionKey = 'doing' | 'todo' | 'blocked' | 'done'
export function sections(beads: Bead[], ready: Set<string>): [SectionKey, Bead[]][] {
  const { todo, done } = group(beads)
  return [
    // Epics in progress included: All lists everything.
    ['doing', beads.filter(isDoing).sort(byUpdatedDesc)],
    ['todo', todo.filter((b) => !isWaiting(b, ready))],
    ['blocked', todo.filter((b) => isWaiting(b, ready))],
    ['done', done]
  ]
}

/** A query as the lowercase words a match must all contain. */
export const queryWords = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)
/** What a query is matched against: title and id, lowercase. */
export const searchText = (b: Bead) => `${b.title} ${b.id}`.toLowerCase()
/** Title or id contains every word of the query, any case. */
export const matches = (b: Bead, q: string) => queryWords(q).every((word) => searchText(b).includes(word))

/** Work order: what is moving, then what is open by priority, then what is done. */
const rank = (b: Bead) => (isDoing(b) ? 0 : b.status === 'closed' ? 2 : 1)
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
      return { epic, children: kids, done: kids.filter((b) => b.status === 'closed').length }
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
