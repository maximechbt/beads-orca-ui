// What a write does to the tasks the panel shows, before bd confirms it. Pure: the panel keeps bd's
// answers as they came and draws them with the writes still in flight laid on top, so a write that
// fails simply stops being laid on.
import type {} from './protocol.ts'

/** What a new task is made of, as the create form sends it. */
export type NewTask = { title: string; type: string; priority: number; parent?: string; description?: string; labels?: string[]; due?: string; estimate?: number }

/** A write in flight: a change to a task, or a task being created under a temporary id. */
export type Write = { kind: 'act'; action: BeadAction } | { kind: 'create'; id: string; task: NewTask }

/** What a write needs to know beyond the task itself. */
export type Context = { me?: string; now: Date; find: (id: string) => { title: string; status: string } | undefined }

/** Ids of tasks not created yet; they never reach bd. */
export const isTemp = (id: string) => id.startsWith('~')

/**
 * A date as bd reads `--due` and `--defer`, for the ones the panel offers or a person often types:
 * today, tomorrow, +3h, +2d, +1w, 2026-12-01. Null for anything else: bd will say what it meant.
 */
export function dateFrom(value: string, now: Date): string | null {
  const v = value.trim().toLowerCase()
  const day = (offset: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + offset)
    return d.toISOString()
  }
  if (v === 'today') return day(0)
  if (v === 'tomorrow') return day(1)
  const rel = v.match(/^\+(\d{1,4})([hdw])$/)
  if (rel) return new Date(now.getTime() + Number(rel[1]) * { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[rel[2] as 'h' | 'd' | 'w']).toISOString()
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString()
  return null
}

/** The status a write leaves its task in, when it changes it. */
function statusAfter(a: BeadAction, ctx: Context): string | undefined {
  switch (a.action) {
    case 'claim':
      return 'in_progress'
    case 'close':
    case 'duplicate':
    case 'supersede':
      return 'closed'
    case 'reopen':
    case 'release':
      return 'open'
    case 'status':
      return a.value
    case 'field':
      if (a.field !== 'defer') return undefined
      // bd hides a deferred task until the date, then wakes it up.
      return a.value?.trim() ? ((dateFrom(a.value, ctx.now) ?? '') > ctx.now.toISOString() ? 'deferred' : undefined) : 'open'
    default:
      return undefined
  }
}

const without = <T>(list: T[] | undefined, drop: (x: T) => boolean) => (list ?? []).filter((x) => !drop(x))

/** The fields a write changes on the task it targets, as the list holds them. */
function patchBead<B extends Bead>(b: B, a: BeadAction, ctx: Context): B {
  const next: B = { ...b, updated_at: ctx.now.toISOString() }
  const status = statusAfter(a, ctx)
  if (status && !(a.action === 'field' && status === 'open' && b.status !== 'deferred')) next.status = status
  switch (a.action) {
    case 'claim':
    case 'assign-me':
      if (ctx.me) next.assignee = ctx.me
      break
    case 'release':
    case 'unassign':
      delete next.assignee
      break
    case 'assign':
      next.assignee = a.value?.trim()
      break
    case 'priority':
      next.priority = a.priority ?? b.priority
      break
    case 'edit':
      if (a.fields?.title?.trim()) next.title = a.fields.title.trim()
      if (a.fields?.type) next.issue_type = a.fields.type
      break
    case 'parent':
      if (a.other) next.parent = a.other
      else delete next.parent
      break
    case 'label-add':
      next.labels = [...without(b.labels, (l) => l === a.value), a.value!.trim()]
      break
    case 'label-remove':
      next.labels = without(b.labels, (l) => l === a.value)
      break
    case 'block':
      // The list says what a task still waits on: an unfinished blocker only.
      if (a.other && ctx.find(a.other)?.status !== 'closed') next.waits_on = [...without(b.waits_on, (id) => id === a.other), a.other]
      break
    case 'unblock':
      next.waits_on = without(b.waits_on, (id) => id === a.other)
      break
    case 'field':
      if (a.field === 'due') {
        const due = a.value?.trim() ? dateFrom(a.value, ctx.now) : ''
        if (due) next.due_at = due
        else if (due === '') delete next.due_at
      }
      break
  }
  if (!next.waits_on?.length) delete next.waits_on
  if (!next.labels?.length) delete next.labels
  return next
}

/** A write that finishes a task frees the tasks that waited on it. */
const finishes = (a: BeadAction) => a.action === 'close' || a.action === 'duplicate' || a.action === 'supersede' || a.action === 'delete'

function newBead(w: Extract<Write, { kind: 'create' }>, ctx: Context): Bead {
  const t = w.task
  const due = t.due ? dateFrom(t.due, ctx.now) : null
  return {
    id: w.id,
    title: t.title.trim(),
    status: 'open',
    priority: t.priority,
    issue_type: t.type,
    ...(t.parent ? { parent: t.parent } : {}),
    ...(t.labels?.length ? { labels: t.labels } : {}),
    ...(due ? { due_at: due } : {}),
    updated_at: ctx.now.toISOString()
  }
}

/** The list as it will be once every write in flight lands. */
export function applyToList<L extends { beads: Bead[]; ready: string[] }>(list: L, writes: Write[], ctx: Context): L {
  let beads = list.beads
  const touched = new Set<string>()
  for (const w of writes) {
    if (w.kind === 'create') {
      if (!beads.some((b) => b.id === w.id)) beads = [...beads, newBead(w, ctx)]
      touched.add(w.id)
      continue
    }
    const a = w.action
    if (a.action === 'delete') (touched.add(a.id), (beads = beads.filter((b) => b.id !== a.id)))
    else beads = beads.map((b) => (b.id === a.id ? (touched.add(b.id), patchBead(b, a, ctx)) : b))
    if (finishes(a))
      beads = beads.map((b) => {
        if (!b.waits_on?.includes(a.id)) return b
        touched.add(b.id)
        const waits = b.waits_on.filter((id) => id !== a.id)
        const { waits_on: _, ...rest } = b
        return waits.length ? { ...rest, waits_on: waits } : rest
      })
  }
  // A touched task is ready when it is open and waits on nothing, as `bd ready` would say.
  const ready = new Set(list.ready)
  for (const b of beads) if (touched.has(b.id)) (b.status === 'open' && !b.waits_on?.length ? ready.add(b.id) : ready.delete(b.id))
  for (const id of touched) if (!beads.some((b) => b.id === id)) ready.delete(id)
  return { ...list, beads, ready: [...ready] }
}

/** A link to `id`, with what the list knows of it. */
function linkTo(id: string, type: string, ctx: Context): BeadLink {
  const known = ctx.find(id)
  return { id, title: known?.title ?? id, status: known?.status ?? 'open', dependency_type: type }
}

/** One task in full as it will be once every write in flight lands. */
export function applyToDetail(d: BeadDetail, writes: Write[], ctx: Context): BeadDetail {
  let next = d
  for (const w of writes) {
    if (w.kind === 'create') continue
    const a = w.action
    if (a.id === next.id) next = patchDetail(patchBead(next, a, ctx), a, ctx)
    else if (a.other === next.id) next = patchOther(next, a, ctx)
    // A linked task that changed state shows its new state in this one's links.
    const status = statusAfter(a, ctx)
    if (status) {
      const restate = (l: BeadLink) => (l.id === a.id ? { ...l, status } : l)
      next = { ...next, dependencies: next.dependencies?.map(restate), dependents: next.dependents?.map(restate) }
    }
  }
  return next
}

/** What a write changes on the task it targets beyond the list's fields: text, links, comments, dates. */
function patchDetail(d: BeadDetail, a: BeadAction, ctx: Context): BeadDetail {
  const next = { ...d }
  const text = (v?: string) => (v?.trim() ? v.trim() : undefined)
  switch (a.action) {
    case 'close':
      next.closed_at = ctx.now.toISOString()
      next.close_reason = text(a.reason)
      break
    case 'reopen':
      delete next.closed_at
      delete next.close_reason
      break
    case 'comment':
      next.comments = [...(d.comments ?? []), { id: `~${ctx.now.getTime()}`, author: ctx.me ?? '…', text: a.text?.trim() ?? '', created_at: ctx.now.toISOString() }]
      break
    case 'edit': {
      const f = a.fields ?? {}
      if (f.description !== undefined) next.description = text(f.description)
      if (f.acceptance !== undefined) next.acceptance_criteria = text(f.acceptance)
      if (f.design !== undefined) next.design = text(f.design)
      if (f.notes !== undefined) next.notes = text(f.notes)
      break
    }
    case 'block':
    case 'link':
    case 'duplicate':
    case 'supersede': {
      const type = { block: 'blocks', link: 'related', duplicate: 'duplicates', supersede: 'supersedes' }[a.action]
      next.dependencies = [...without(d.dependencies, (l) => l.id === a.other && l.dependency_type === type), linkTo(a.other!, type, ctx)]
      break
    }
    case 'unblock':
      next.dependencies = without(d.dependencies, (l) => l.id === a.other && l.dependency_type === 'blocks')
      break
    case 'unlink':
      next.dependencies = without(d.dependencies, (l) => l.id === a.other && l.dependency_type === 'related')
      next.dependents = without(d.dependents, (l) => l.id === a.other && l.dependency_type === 'related')
      break
    case 'parent':
      next.dependencies = [...without(d.dependencies, (l) => l.dependency_type === 'parent-child'), ...(a.other ? [linkTo(a.other, 'parent-child', ctx)] : [])]
      break
    case 'field': {
      const v = a.value?.trim() ?? ''
      if (a.field === 'defer') {
        const at = v ? dateFrom(v, ctx.now) : ''
        if (at) next.defer_until = at
        else if (at === '') delete next.defer_until
      }
      if (a.field === 'estimate') next.estimated_minutes = Number(v) || undefined
      if (a.field === 'external-ref') next.external_ref = v || undefined
      if (a.field === 'spec-id') next.spec_id = v || undefined
      break
    }
  }
  return next
}

/** What a write on another task changes here: the other side of a link. */
function patchOther(d: BeadDetail, a: BeadAction, ctx: Context): BeadDetail {
  switch (a.action) {
    case 'block':
      return { ...d, dependents: [...without(d.dependents, (l) => l.id === a.id && l.dependency_type === 'blocks'), linkTo(a.id, 'blocks', ctx)] }
    case 'unblock':
      return { ...d, dependents: without(d.dependents, (l) => l.id === a.id && l.dependency_type === 'blocks') }
    case 'link':
      return { ...d, dependents: [...without(d.dependents, (l) => l.id === a.id && l.dependency_type === 'related'), linkTo(a.id, 'related', ctx)] }
    case 'unlink':
      return {
        ...d,
        dependencies: without(d.dependencies, (l) => l.id === a.id && l.dependency_type === 'related'),
        dependents: without(d.dependents, (l) => l.id === a.id && l.dependency_type === 'related')
      }
    default:
      return d
  }
}

/** A task being created, in full, so it can open before bd gives it an id. */
export function newDetail(w: Extract<Write, { kind: 'create' }>, ctx: Context): BeadDetail {
  const b = newBead(w, ctx)
  return {
    ...b,
    description: w.task.description?.trim() || undefined,
    estimated_minutes: w.task.estimate,
    created_at: ctx.now.toISOString(),
    dependencies: w.task.parent ? [linkTo(w.task.parent, 'parent-child', ctx)] : [],
    dependents: [],
    comments: []
  }
}
