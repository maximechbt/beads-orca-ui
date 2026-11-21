// One task: its properties as menus, its actions, its text, links and comments.
import { isDoing, isDone, flat } from '../../src/model.ts'
import { isTemp } from '../../src/optimistic.ts'
import { ICON } from '../glyphs.ts'
import { markdown } from '../markdown.ts'
import { addComment, confirmClose, confirmDelete, confirmRelease, open, openCreate, openEdit, openLaunch, quickLaunch, startClosing, startRelease } from '../actions.ts'
import { act, beads, byId, epicFor, loadTargets, readySet, shortId, shownDetail } from '../data.ts'
import { anchorOf, glyph, html, valueOf } from '../dom.ts'
import type { Child } from '../dom.ts'
import { isOpen, openMenu } from '../menu.ts'
import type { MenuItem } from '../menu.ts'
import { render } from '../render.ts'
import { state, t, WIDE } from '../state.ts'
import type { Ref } from '../state.ts'
import { copy, openLink } from '../toast.ts'
import { ago, avatar, detailSkeleton, problemState, section, statusGlyph, statusLabel, topbar, when } from '../ui.ts'
import { fieldItems, fieldOpts, properties } from './properties.ts'
import type { Field } from './properties.ts'

const KNOWN_LINKS = ['parent-child', 'blocks', 'duplicates', 'supersedes']

/** Links split by direction and kind, in the order a person reads them. */
function linkGroups(b: BeadDetail): [string, string, BeadLink[]][] {
  const deps = b.dependencies ?? []
  const dents = b.dependents ?? []
  const m = t()
  return (
    [
      ['parent', m.parent, deps.filter((l) => l.dependency_type === 'parent-child')],
      ['dupOf', m.duplicateOf, deps.filter((l) => l.dependency_type === 'duplicates')],
      ['supBy', m.supersededBy, deps.filter((l) => l.dependency_type === 'supersedes')],
      ['blocks', m.blocks, dents.filter((l) => l.dependency_type === 'blocks')],
      ['dups', m.duplicates, dents.filter((l) => l.dependency_type === 'duplicates')],
      ['replaces', m.replaces, dents.filter((l) => l.dependency_type === 'supersedes')],
      ['related', m.related, [...deps, ...dents].filter((l) => !KNOWN_LINKS.includes(l.dependency_type))]
    ] as [string, string, BeadLink[]][]
  ).filter(([, , links]) => links.length > 0)
}

/** The breadcrumb: the task's epic, when it has one, then its id. */
function crumbs(id: string, epic: Bead | null): Child {
  return [
    epic && epic.id !== id
      ? [html`<button type="button" onClick=${() => open(epic.id)}>${epic.title}</button>`, html`<span aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICON.chevron }} />`]
      : null,
    // A task still being created has no id yet.
    html`<span class="here num">${isTemp(id) ? '…' : id}</span>`
  ]
}

export function detailView() {
  const m = t()
  const id = state.ui.openId ?? ''
  const answer = shownDetail()?.answer ?? null
  if (!answer) {
    // The list already knows the task: its breadcrumb and title show at once.
    const known = byId().get(id)
    return html`<div>${topbar(crumbs(id, known ? epicFor(known) : null))}<div class="doc">${detailSkeleton(known)}</div></div>`
  }
  const b = answer.bead
  if (!b) return html`<div>${topbar(html`<span class="here">${shortId(id)}</span>`)}${problemState(answer.problem ?? 'not-found', answer.error, id)}</div>`
  const epic = epicFor(b)
  const texts = (
    [
      ['acceptance', m.acceptance, b.acceptance_criteria, true],
      ['design', m.design, b.design, false],
      ['notes', m.notes, b.notes, false]
    ] as [string, string, string | undefined, boolean][]
  ).filter((x): x is [string, string, string, boolean] => Boolean(x[2]))
  const children = (b.dependents ?? []).filter((l) => l.dependency_type === 'parent-child')
  const facts = [
    ['ID', b.id],
    [m.created, when(b.created_at)],
    [m.updated, when(b.updated_at)],
    [m.closedAt, when(b.closed_at)],
    [m.closeReason, b.close_reason],
    [m.createdBy, b.created_by],
    [m.owner, b.owner],
    // Free key/values from `bd update --set-metadata`, under their own keys.
    ...Object.entries(b.metadata ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
  ].filter(([, v]) => v)
  const body = [
    html`<div class="desc">${b.description ? markdown(flat(b.description), openLink) : html`<p class="empty-line">${m.noDescription}</p>`}</div>`,
    html`${texts.map(([key, title, text, open]) => section(key, title, null, open, () => markdown(flat(text), openLink)))}
        ${children.length
          ? section('children', m.children, `${children.filter(isDone).length}/${children.length}`, true, () => children.map(linkRow))
          : null}
        ${blockers(b)}
        ${
          // The parent is a property; every other link can be undone from its row.
          linkGroups(b)
            .filter(([key]) => key !== 'parent')
            .map(([key, label, links]) => section(key, label, links.length, true, () => links.map((l) => removableLink(b, key, l))))
        }
        ${comments(b)}`
  ]
  return html`
    <div>
      ${topbar(
        crumbs(b.id, epic),
        html`<button class="ib" type="button" aria-label=${m.edit} title=${m.edit} data-k="edit" onClick=${() => openEdit(b)} dangerouslySetInnerHTML=${{ __html: ICON.edit }} />`,
        html`<button
          class="ib"
          type="button"
          aria-label=${m.more}
          title=${m.more}
          aria-haspopup="menu"
          aria-expanded=${String(isOpen('more'))}
          data-k="more"
          onClick=${(e: Event) => openMenu(anchorOf(e), moreItems(anchorOf(e), b))}
          dangerouslySetInnerHTML=${{ __html: ICON.more }}
        />`
      )}
      ${WIDE ? taskPage(b, epic, body, facts) : html`<div class="doc">
        <h1>${b.title}</h1>
        ${properties(b, epic, readySet())}
        ${actions(b)}
        ${body}
        ${factList(facts)}
      </div>`}
    </div>
  `
}

/** When the task was made and closed, and by whom. */
const factList = (facts: (string | null | undefined)[][]) => html`<dl class="facts">${facts.map(([k, v]) => html`<dt>${k}</dt><dd class="num">${v}</dd>`)}</dl>`

/** In the big view a task is a page: its text in a reading column, what describes it and the actions in a rail. */
function taskPage(b: BeadDetail, epic: Bead | null, body: unknown, facts: (string | null | undefined)[][]) {
  return html`
    <div class="page">
      <h1>${b.title}</h1>
      <article class="page-main">${body}</article>
      <aside class="page-rail">
        ${actions(b)}
        ${properties(b, epic, readySet())}
        ${factList(facts)}
      </aside>
    </div>
  `
}

/** Start in one press: each agent here, the one Orca would pick first; a new worktree or another prompt go through the form. */
export async function startMenu(anchor: HTMLElement, b: Ref) {
  const m = t()
  if (!state.targets) await loadTargets({ quiet: true })
  const ts = state.targets ?? { workspaces: [], agents: [] }
  const here = ts.workspaces.find((w) => w.id === ts.current) ?? ts.workspaces[0]
  const agents = [...ts.agents].sort((x, y) => (x.id === ts.defaultAgent ? -1 : y.id === ts.defaultAgent ? 1 : 0))
  if (!agents.length) return openLaunch(b)
  openMenu(anchor, [
    ...(here ? agents.map((a) => ({ label: a.name, hint: here.name, icon: ICON.agent, run: () => quickLaunch(b, a, here.id) })) : []),
    'sep',
    { label: m.newWorktree + '…', icon: ICON.add, run: () => openLaunch(b, 'new') },
    { label: m.editPrompt, icon: ICON.edit, run: () => openLaunch(b) }
  ])
}

/** Done in one press; a reason, or the task it duplicates or that replaces it, one step further. */
export function finishMenu(anchor: HTMLElement, b: Ref) {
  const m = t()
  // Any other task can be the canonical one or the replacement.
  const others = beads().filter((o) => o.id !== b.id)
  const pick = (how: 'duplicate' | 'supersede') => () =>
    openMenu(anchor, others.map((o) => ({ label: o.title, hint: shortId(o.id), run: () => act({ id: b.id, action: how, other: o.id }, m.closed) })), { search: true })
  openMenu(anchor, [
    { label: m.closeDone, icon: ICON.check, run: () => act({ id: b.id, action: 'close', reason: '' }, m.closed) },
    { label: m.closeWithReason, icon: ICON.edit, run: startClosing },
    'sep',
    { label: m.closeDuplicate + '…', icon: ICON.copy, run: pick('duplicate') },
    { label: m.closeSupersede + '…', icon: ICON.refresh, run: pick('supersede') }
  ])
}

function actions(b: BeadDetail) {
  const m = t()
  const closed = b.status === 'closed'
  const doing = isDoing(b)
  // An agent launched here has not claimed the task yet: say so, and make starting another one deliberate.
  const startedBy = !closed && !doing ? state.ui.launched[b.id] : null
  const busy = state.busy
  const sheet = state.deleting === b.id ? deleteSheet() : state.releasing === b.id ? releaseSheet(b) : state.closing ? reasonSheet(b) : null
  const buttons = html`
    ${!closed && !doing
      ? html`<button class=${`btn${startedBy ? '' : ' primary'}`} type="button" disabled=${busy} data-k="start" aria-haspopup="menu" aria-expanded=${String(isOpen('start'))} onClick=${(e: Event) => startMenu(anchorOf(e), b)}>
          ${glyph(ICON.play)}${startedBy ? m.startAgain : m.start}${glyph(ICON.down, 'caret')}
        </button>`
      : null}
    ${
      // Agents usually close their own tasks: finishing by hand stays a secondary action.
      !closed
        ? html`<button class="btn" type="button" disabled=${busy} data-k="finish" aria-haspopup="menu" aria-expanded=${String(isOpen('finish'))} onClick=${(e: Event) => finishMenu(anchorOf(e), b)}>
            ${glyph(ICON.check)}${m.finish}${glyph(ICON.down, 'caret')}
          </button>`
        : null
    }
    ${
      // Takes the task back from whoever holds it, a crashed agent included; confirmed first.
      doing ? html`<button class="btn ghost" type="button" disabled=${busy} onClick=${() => startRelease(b.id)}>${m.release}</button>` : null
    }
    ${closed ? html`<button class="btn" type="button" disabled=${busy} onClick=${() => act({ id: b.id, action: 'reopen' }, m.reopened)}>${glyph(ICON.refresh)}${m.reopen}</button>` : null}
    ${b.issue_type === 'epic' ? html`<button class="btn ghost" type="button" disabled=${busy} onClick=${() => openCreate({ id: b.id, title: b.title })}>${glyph(ICON.add)}${m.subtask}</button>` : null}
  `
  return html`
    <div class="acts">
      ${sheet ?? buttons}
      ${startedBy && !state.closing && state.releasing !== b.id ? html`<p class="note">${glyph(ICON.agent)}${m.agentStarted(startedBy)}</p>` : null}
    </div>
  `
}

/** A confirmation in place of the actions: what it does, the button that does it, and a way out. */
function sheet(cls: string, body: Child, go: Child, cancel: () => void) {
  return html`
    <div class=${`sheet${cls ? ` ${cls}` : ''}`}>
      ${body}
      <div class="row-btns">
        ${go}
        <button class="btn ghost" type="button" onClick=${() => (cancel(), render())}>${t().cancel}</button>
      </div>
    </div>
  `
}

function releaseSheet(b: BeadDetail) {
  const m = t()
  return sheet(
    '',
    html`<span>${m.releaseConfirm(b.assignee ?? m.holder)}</span>`,
    html`<button class="btn primary" type="button" data-k="release:go" disabled=${state.busy} onClick=${() => confirmRelease(b.id)}>${m.release}</button>`,
    () => (state.releasing = null)
  )
}

function deleteSheet() {
  const m = t()
  const id = state.deleting!
  return sheet(
    'danger',
    html`<span>${m.deleteConfirm}</span>`,
    html`<button class="btn danger-solid" type="button" data-k="delete:go" disabled=${state.busy} onClick=${() => confirmDelete(id)}>${glyph(ICON.delete)}${m.deleteTask}</button>`,
    () => (state.deleting = null)
  )
}

function reasonSheet(b: BeadDetail) {
  const m = t()
  return sheet(
    '',
    html`<label class="field">
      <span>${m.closeReasonLabel}</span>
      <input
        class="input"
        data-k="close:reason"
        value=${state.closing?.reason ?? ''}
        placeholder=${m.closeReasonPlaceholder}
        onInput=${(e: Event) => state.closing && (state.closing.reason = valueOf(e))}
        onKeyDown=${(e: KeyboardEvent) => e.key === 'Enter' && confirmClose(b.id)}
      />
    </label>`,
    html`<button class="btn primary" type="button" disabled=${state.busy} onClick=${() => confirmClose(b.id)}>${glyph(ICON.check)}${m.closeBead}</button>`,
    () => (state.closing = null)
  )
}

function linkRow(l: BeadLink) {
  return html`
    <button key=${l.id} class="link" type="button" data-ahead=${l.id} title=${`${l.id} · ${statusLabel(l.status)}`} onClick=${() => open(l.id)}>
      ${statusGlyph(l, null)}
      <span class="t">${l.title}</span>
      <span class="id num">${shortId(l.id)}</span>
    </button>
  `
}

/** A link row with a × beside it that undoes the link. */
function undoableLink(l: BeadLink, label: string, undo: BeadAction, notice: string) {
  return html`
    <div key=${l.id} class="link-row">
      ${linkRow(l)}
      <button class="ib" type="button" aria-label=${label} title=${label} disabled=${state.busy} onClick=${() => act(undo, notice)} dangerouslySetInnerHTML=${{ __html: ICON.close }} />
    </div>
  `
}

/** A link the person can undo, in the direction bd stored it. */
function removableLink(b: BeadDetail, key: string, l: BeadLink) {
  const m = t()
  const mine = (b.dependencies ?? []).some((d) => d.id === l.id && d.dependency_type === l.dependency_type)
  const undo: BeadAction | null =
    key === 'blocks' ? { id: l.id, action: 'unblock', other: b.id } : key === 'related' ? { id: mine ? b.id : l.id, action: 'unlink', other: mine ? l.id : b.id } : null
  return undo ? undoableLink(l, m.removeLink(l.title), undo, m.saved) : linkRow(l)
}

/** What else can be done to a task: copy its id, link it, set a field it lacks, delete it. */
function moreItems(anchor: HTMLElement, b: BeadDetail): MenuItem[] {
  const m = t()
  const linked = new Set([...(b.dependencies ?? []), ...(b.dependents ?? [])].map((l) => l.id))
  const waitsOn = (b.dependencies ?? []).filter((l) => l.dependency_type === 'blocks')
  const unfinished = beads().filter((o) => o.id !== b.id && !isDone(o))
  const pick = (list: Bead[], run: (o: Bead) => unknown) => () =>
    openMenu(anchor, list.map((o) => ({ label: o.title, hint: shortId(o.id), run: () => run(o) })), { search: true })
  // Fields a task does not have yet; once set, each one is a property row with its own menu.
  const unset = ([
    ['due', m.due, !b.due_at],
    ['defer', m.deferUntil, !b.defer_until],
    ['estimate', m.estimate, !b.estimated_minutes],
    ['external-ref', m.externalRef, !b.external_ref],
    ['spec-id', m.spec, !b.spec_id]
  ] as [Field, string, boolean][]).filter(([, , missing]) => missing)
  const items: (MenuItem | null)[] = [
    { label: m.copyId, icon: ICON.copy, hint: shortId(b.id), run: () => copy(b.id, m.copied) },
    'sep',
    // A task can wait on any other unfinished task it does not already wait on.
    { label: m.addBlocker, icon: ICON.pause, run: pick(unfinished.filter((o) => !waitsOn.some((l) => l.id === o.id)), (o) => act({ id: b.id, action: 'block', other: o.id }, m.blockerAdded)) },
    { label: m.makeWait, icon: ICON.pause, run: pick(unfinished.filter((o) => !linked.has(o.id)), (o) => act({ id: o.id, action: 'block', other: b.id }, m.blockerAdded)) },
    { label: m.addRelated, icon: ICON.link, run: pick(beads().filter((o) => o.id !== b.id && !linked.has(o.id)), (o) => act({ id: b.id, action: 'link', other: o.id }, m.saved)) },
    b.issue_type === 'epic' ? { label: m.subtask, icon: ICON.add, run: () => openCreate({ id: b.id, title: b.title }) } : null,
    unset.length ? 'sep' : null,
    ...unset.map(([field, label]): MenuItem => ({ label: `${label}…`, icon: ICON.add, run: () => openMenu(anchor, fieldItems(b, field), fieldOpts(b, field)) })),
    'sep',
    { label: m.deleteTask + '…', icon: ICON.delete, iconClass: 'danger', run: () => askDelete(b.id) }
  ]
  return items.filter((x) => x !== null)
}

function askDelete(id: string) {
  state.deleting = id
  state.closing = state.releasing = null
  render({ focus: 'delete:go' })
}

/** What the task waits on; the × beside one stops waiting on it. */
function blockers(b: BeadDetail) {
  const m = t()
  const list = (b.dependencies ?? []).filter((l) => l.dependency_type === 'blocks')
  if (!list.length) return null
  return section('blockedBy', m.blockedBy, list.length, true, () =>
    list.map((l) => undoableLink(l, m.removeBlocker(l.title), { id: b.id, action: 'unblock', other: l.id }, m.blockerRemoved))
  )
}

/** The thread, oldest first, then a box to add to it. */
function comments(b: BeadDetail) {
  const m = t()
  const list = b.comments ?? []
  const onInput = (e: Event) => {
    state.comment = valueOf(e)
    render()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    addComment(b.id)
  }
  return section('comments', m.comments, list.length || null, true, () => [
    list.map(
      (c) => html`
        <div key=${c.id} class="comment">
          ${avatar(c.author)}
          <div class="who"><span>${c.author}</span><time datetime=${c.created_at} title=${when(c.created_at)}>${ago(Date.parse(c.created_at))}</time></div>
          ${markdown(flat(c.text), openLink)}
        </div>
      `
    ),
    html`
      <div key="composer" class=${`composer${state.comment ? ' has' : ''}`}>
        <textarea data-k="composer" aria-label=${m.addComment} placeholder=${m.addCommentPlaceholder} rows="2" value=${state.comment} onInput=${onInput} onKeyDown=${onKeyDown} />
        <div class="foot">
          <span>${m.sendHint}</span>
          <button class="btn sm" type="button" disabled=${state.busy || !state.comment.trim()} onClick=${() => addComment(b.id)}>${m.postComment}</button>
        </div>
      </div>
    `
  ])
}
