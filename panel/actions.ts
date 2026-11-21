// What a press does: open a task, a form or the memory, and send what they hold.
import { parseMinutes } from '../src/model.ts'
import { request } from './bridge.ts'
import { isTemp } from '../src/optimistic.ts'
import { act, create, details, loadDetail, loadMemories, loadTargets } from './data.ts'
import { closeMenu } from './menu.ts'
import { render } from './render.ts'
import { save, state, t } from './state.ts'
import type { Form, Ref } from './state.ts'
import type { PluginRequestInput } from 'orca'

/** The header's brain: opens the memory, or closes it when open. */
export const toggleMemory = () => (state.ui.memory && !state.ui.form ? back() : openMemory())
/** The header's +: a memory in the memory view, a task anywhere else. */
export const newHere = () => (state.ui.memory && !state.ui.form ? newMemory() : openCreate(null))

/** Opens the big view in the middle of Orca; the worker makes its file and asks Orca to open it. */
export async function openBoard() {
  const r = await request('beads.board').catch((err: Error) => ({ ok: false, problem: 'failed' as const, error: err.message }))
  if (!r.ok) {
    state.outcome = { problem: r.problem ?? 'failed', error: r.error }
    render()
  }
}

export function openMemory() {
  state.ui.memory = true
  state.memEdit = null
  state.forgetting = null
  state.memQuery = ''
  closeMenu()
  render({ top: true })
  save()
  void loadMemories()
}

export function open(id: string) {
  state.ui.openId = id
  state.ui.form = null
  // What was read ahead shows now; the read below brings it up to date.
  const known = details.get(id)
  state.detail = state.detail?.id === id ? state.detail : known ? { id, answer: known } : null
  state.closing = state.releasing = state.deleting = null
  state.comment = ''
  state.outcome = null
  state.secs = {}
  closeMenu()
  render({ top: true })
  save()
  // A task still being created has nothing to read yet: it is drawn from what was typed.
  if (!isTemp(id)) void loadDetail(id)
}

export function back() {
  if (state.ui.form) {
    state.ui.form = null
    state.outcome = null
  } else if (state.ui.memory) {
    state.ui.memory = false
    state.memEdit = null
    state.forgetting = null
  } else {
    state.ui.openId = null
    state.detail = null
  }
  closeMenu()
  render({ top: true })
  save()
}

export function openCreate(parent: Ref | null, type = 'task', title = '') {
  state.ui.draft = { title, type, priority: '2', description: '', parent: parent?.id ?? '', labels: '', due: '', estimate: '' }
  state.outcome = null
  state.ui.form = { kind: 'create', parent }
  render({ top: true, focus: 'f:title' })
  save()
}

/** Creates the drafted task, then opens it, or with `andStart` goes straight to launching an agent on it. */
const labelsOf = (text: string) => text.split(',').map((l) => l.trim()).filter(Boolean)

export async function submitCreate(andStart = false) {
  const d = state.ui.draft
  if (!d.title.trim() || state.busy) return
  if (d.estimate.trim() && !parseMinutes(d.estimate)) return void ((state.outcome = { problem: 'failed', error: t().estimateHint }), render())
  const form = state.ui.form
  const title = d.title.trim()
  // Optional keys are left out rather than undefined: Orca refuses requests that are not JSON.
  const made = create({
    title: d.title,
    type: d.type,
    priority: Number(d.priority),
    ...(d.parent ? { parent: d.parent } : {}),
    ...(d.description?.trim() ? { description: d.description } : {}),
    ...(labelsOf(d.labels).length ? { labels: labelsOf(d.labels) } : {}),
    ...(d.due.trim() ? { due: d.due.trim() } : {}),
    ...(parseMinutes(d.estimate) ? { estimate: parseMinutes(d.estimate)! } : {})
  })
  // Launching needs the real id in its prompt: that path waits for bd; the other opens the task at once.
  if (andStart) {
    state.busy = true
    render()
  } else open(made.id)
  const id = await made.done
  state.busy = false
  if (id && andStart) return void openLaunch({ id, title })
  if (id) {
    if (state.ui.openId === made.id) open(id)
    return
  }
  // Refused: back to the form, with everything typed still there.
  state.ui.openId = null
  state.ui.form = form
  render({ top: true })
}

export function openEdit(b: BeadDetail) {
  state.ui.editDraft = {
    title: b.title,
    type: b.issue_type ?? 'task',
    description: b.description ?? '',
    acceptance: b.acceptance_criteria ?? '',
    design: b.design ?? '',
    notes: b.notes ?? ''
  }
  state.outcome = null
  state.ui.form = { kind: 'edit', bead: { id: b.id, title: b.title } }
  render({ top: true, focus: 'f:title' })
  save()
}

export async function submitEdit(id: string) {
  const d = state.ui.editDraft
  const form = state.ui.form
  if (!d.title.trim()) return
  state.ui.form = null
  save()
  // Refused: the form comes back with the edits in it.
  if (!(await act({ id, action: 'edit', fields: { ...d } }, t().saved))) {
    state.ui.form = form
    render({ top: true })
  }
}

/** What the agent is told by default; the person can rewrite it before launching. */
const promptFor = (b: Ref) => t().promptFor(b.id)

export async function openLaunch(bead: Ref, target = '') {
  state.ui.launch = { agent: '', target, name: bead.id, prompt: promptFor(bead) }
  state.outcome = null
  state.ui.form = { kind: 'launch', bead }
  render({ top: true })
  save()
  await loadTargets()
}

/**
 * Launches an agent: the task says so at once and the panel moves on; a refusal takes the mark back
 * and, when a form was used, brings it back as it was.
 */
async function launch(bead: Ref, agentName: string, input: PluginRequestInput<'beads.launch'>, form: Form | null) {
  const before = state.ui.launched[bead.id]
  state.ui.launched = { ...state.ui.launched, [bead.id]: agentName }
  state.outcome = null
  render({ top: true })
  save()
  let r: ActResult & { where?: string }
  try {
    // A new worktree runs its setup before the agent starts: give it the longest wait Orca allows.
    r = await request('beads.launch', input, 120_000)
  } catch (err) {
    r = { ok: false, problem: 'failed', error: (err as Error).message }
  }
  if (r.ok) state.outcome = { notice: t().launched(agentName, r.where ?? '') }
  else {
    const { [bead.id]: _, ...rest } = state.ui.launched
    state.ui.launched = before ? { ...rest, [bead.id]: before } : rest
    if (form) state.ui.form = form
    state.outcome = { problem: r.problem ?? 'failed', error: r.error }
  }
  render()
  save()
}

export function submitLaunch() {
  const f = state.ui.form
  const l = state.ui.launch
  if (f?.kind !== 'launch') return
  const agentName = state.targets?.agents.find((a) => a.id === l.agent)?.name ?? l.agent
  state.ui.form = null
  void launch(f.bead, agentName, { agent: l.agent, prompt: l.prompt, target: l.target, name: l.name }, f)
}

export async function addComment(id: string) {
  const text = state.comment
  if (!text.trim()) return
  state.comment = ''
  // Refused: the text comes back in the box, unless something new was typed meanwhile.
  if (!(await act({ id, action: 'comment', text }, t().commented)) && !state.comment) {
    state.comment = text
    render()
  }
}

export function confirmClose(id: string) {
  const c = state.closing
  if (!c) return
  state.closing = null
  void act({ id, action: 'close', reason: c.reason }, t().closed)
}

export function confirmRelease(id: string) {
  state.releasing = null
  void act({ id, action: 'release' }, t().released)
}

export function quickLaunch(b: Ref, agent: { id: string; name: string }, target: string) {
  void launch(b, agent.name, { agent: agent.id, prompt: promptFor(b), target, name: b.id }, null)
}

export function startClosing() {
  state.closing = { reason: '' }
  state.releasing = null
  render({ focus: 'close:reason' })
}

export function startRelease(id: string) {
  state.releasing = id
  state.closing = null
  render({ focus: 'release:go' })
}

export function confirmDelete(id: string) {
  state.deleting = null
  state.ui.openId = null
  state.detail = null
  save()
  // The task leaves the list at once; refused, it comes back and the toast says why.
  void act({ id, action: 'delete' }, t().deleted)
}

export function newMemory() {
  state.memEdit = { key: null, value: '', newKey: '' }
  state.forgetting = null
  render({ top: true, focus: 'mem:value' })
}
