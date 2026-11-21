// The forms: a new task, editing one, and launching an agent on one.
import { allTypes, isDone } from '../../src/model.ts'
import { ICON } from '../glyphs.ts'
import { back, submitCreate, submitEdit, submitLaunch } from '../actions.ts'
import { beads, titleOf } from '../data.ts'
import { anchorOf, glyph, html, valueOf } from '../dom.ts'
import type { Child } from '../dom.ts'
import { openMenu } from '../menu.ts'
import { render } from '../render.ts'
import { save, state, t } from '../state.ts'
import type { Form } from '../state.ts'
import { empty, topbar, typeLabel } from '../ui.ts'

type Option = [value: string, label: string]

const typeOptions = (): Option[] => allTypes().map((v) => [v, typeLabel(v)])

const prioOptions = (): Option[] => t().priorities.map((label, i) => [String(i), label])

/** A choice drawn like the task view's menus rather than the browser's own select. */
function select(k: string, value: string, options: Option[], onChange: (v: string) => void, label: string) {
  const current = options.find(([v]) => v === value)?.[1] ?? options[0]?.[1] ?? ''
  const items = options.map(([v, l]) => ({
    label: l,
    check: v === value,
    run: () => {
      onChange(v)
      save()
      render({ focus: k })
    }
  }))
  return html`
    <button class="input pick" type="button" data-k=${k} aria-haspopup="menu" aria-label=${`${label}: ${current}`} onClick=${(e: Event) => openMenu(anchorOf(e), items)}>
      <span class="t">${current}</span>${glyph(ICON.down, 'down')}
    </button>
  `
}

const field = (label: string, control: Child) => html`<label class="field"><span>${label}</span>${control}</label>`

type TextOpts = { area?: boolean; rows?: number; placeholder?: string; onEnter?: () => void }

/** A text field bound to `draft[key]`, kept across reloads like an unsent message. */
function text<D extends Record<string, string>>(k: string, draft: D, key: keyof D & string, { area = false, rows = 3, placeholder, onEnter }: TextOpts = {}) {
  const onInput = (e: Event) => {
    ;(draft as Record<string, string>)[key] = valueOf(e)
    save()
    render()
  }
  // Enter submits a one-line field; a multi-line one needs ⌘/Ctrl+Enter.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!onEnter || e.key !== 'Enter' || (area && !(e.metaKey || e.ctrlKey))) return
    e.preventDefault()
    onEnter()
  }
  return area
    ? html`<textarea class="textarea" data-k=${k} rows=${rows} placeholder=${placeholder} value=${draft[key]} onInput=${onInput} onKeyDown=${onKeyDown} />`
    : html`<input class="input" data-k=${k} placeholder=${placeholder} value=${draft[key]} onInput=${onInput} onKeyDown=${onKeyDown} />`
}

export function formView() {
  const f = state.ui.form!
  if (f.kind === 'create') return createForm()
  if (f.kind === 'edit') return editForm(f)
  return launchForm(f)
}

function formShell(title: string, sub: string | null, body: Child, buttons: Child) {
  return html`
    <div>
      ${topbar(html`<span class="here">${title}</span>`)}
      <form class="form" onSubmit=${(e: Event) => e.preventDefault()}>
        ${sub ? html`<p class="sub">${sub}</p>` : null}
        ${body}
        <div class="btns">
          ${buttons}
          <button class="btn ghost" type="button" onClick=${back}>${t().cancel}</button>
        </div>
      </form>
    </div>
  `
}

function createForm() {
  const m = t()
  const d = state.ui.draft
  // Open epics a new task can join; none to pick from means no picker.
  const epics = beads().filter((b) => b.issue_type === 'epic' && !isDone(b))
  const blocked = state.busy || !d.title.trim()
  return formShell(
    d.parent ? m.newSubtask : m.newBead,
    d.parent ? titleOf(d.parent) : null,
    html`
      ${field(m.title, text('f:title', d, 'title', { placeholder: m.titlePlaceholder, onEnter: () => submitCreate() }))}
      ${field(m.description, text('f:desc', d, 'description', { area: true, rows: 4, placeholder: m.descriptionPlaceholder }))}
      <div class="two">
        ${field(m.type, select('f:type', d.type, typeOptions(), (v) => (d.type = v), m.type))}
        ${field(m.priority, select('f:prio', d.priority, prioOptions(), (v) => (d.priority = v), m.priority))}
      </div>
      ${epics.length && d.type !== 'epic'
        ? field(m.epic, select('f:epic', d.parent, [['', m.noEpic], ...epics.map((e): Option => [e.id, e.title])], (v) => (d.parent = v), m.epic))
        : null}
      ${field(m.labels, text('f:labels', d, 'labels', { placeholder: m.labelsHint }))}
      <div class="two">
        ${field(m.due, text('f:due', d, 'due', { placeholder: m.dateHint }))}
        ${field(m.estimate, text('f:estimate', d, 'estimate', { placeholder: m.estimateHint }))}
      </div>
    `,
    html`
      <button class="btn primary" type="button" disabled=${blocked} onClick=${() => submitCreate()}>${glyph(ICON.add)}${m.create}</button>
      ${d.type !== 'epic' ? html`<button class="btn" type="button" disabled=${blocked} onClick=${() => submitCreate(true)}>${glyph(ICON.play)}${m.createAndStart}</button>` : null}
    `
  )
}

function editForm(f: Extract<Form, { kind: 'edit' }>) {
  const m = t()
  const d = state.ui.editDraft
  // Rarely filled: folded unless the task already has some.
  const more = state.secs.editMore ?? Boolean(d.design || d.notes)
  const toggle = () => {
    state.secs = { ...state.secs, editMore: !more }
    render()
  }
  return formShell(
    m.editTitle,
    f.bead.id,
    html`
      ${field(m.title, text('f:title', d, 'title', { onEnter: () => submitEdit(f.bead.id) }))}
      ${field(m.type, select('f:type', d.type, typeOptions(), (v) => (d.type = v), m.type))}
      ${field(m.description, text('f:desc', d, 'description', { area: true, rows: 6 }))}
      ${field(m.acceptance, text('f:acc', d, 'acceptance', { area: true, rows: 3 }))}
      <button class="sec-h" type="button" aria-expanded=${String(more)} data-k="f:more" onClick=${toggle}>${glyph(ICON.chevron, 'chev')}${m.designAndNotes}</button>
      ${more ? html`${field(m.design, text('f:design', d, 'design', { area: true }))}${field(m.notes, text('f:notes', d, 'notes', { area: true }))}` : null}
    `,
    html`<button class="btn primary" type="button" disabled=${state.busy || !d.title.trim()} onClick=${() => submitEdit(f.bead.id)}>${glyph(ICON.check)}${m.save}</button>`
  )
}

function launchForm(f: Extract<Form, { kind: 'launch' }>) {
  const m = t()
  const l = state.ui.launch
  const ts = state.targets
  const isNew = l.target === 'new'
  const places: Option[] = [...(ts?.workspaces ?? []).map((w, i): Option => [w.id, i === 0 ? m.thisWorktree(w.name) : w.name]), ['new', m.newWorktree]]
  const agents = (ts?.agents ?? []).map((a): Option => [a.id, a.name])
  const ready = !state.busy && l.agent && l.prompt.trim() && (!isNew || l.name.trim())
  return formShell(
    m.launchTitle,
    `${f.bead.title} · ${f.bead.id}`,
    html`
      ${ts === null
        ? html`<div class="skel" role="status" aria-label=${m.loadingTargets}>${[70, 55].map((w) => html`<div><i style=${`width:${w}%`} /></div>`)}</div>`
        : agents.length === 0
          ? empty(ICON.agent, m.noAgents, m.noAgentsHint)
          : html`
              ${field(m.agent, select('f:agent', l.agent, agents, (v) => (l.agent = v), m.agent))}
              ${field(m.where, select('f:where', l.target, places, (v) => (l.target = v), m.where))}
            `}
      ${isNew ? field(m.worktreeName, text('f:name', l, 'name')) : null}
      ${field(m.prompt, text('f:prompt', l, 'prompt', { area: true, rows: 3, onEnter: submitLaunch }))}
    `,
    html`<button class="btn primary" type="button" disabled=${!ready} onClick=${submitLaunch}>${glyph(ICON.agent)}${isNew ? m.createAndLaunch : m.launch}</button>`
  )
}
