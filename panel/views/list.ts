// The list: All grouped by state, Ready, Epics, and search results.
import { byPriority, sections, byWorkOrder, byEpic, isCustom, isDoing } from '../../src/model.ts'
import { ICON, STATUS } from '../glyphs.ts'
import { open, openCreate } from '../actions.ts'
import { beads, epicFor, readySet, search, shortId, shownList, titleOf, epicProgress } from '../data.ts'
import { glyph, html, memo } from '../dom.ts'
import type { Child } from '../dom.ts'
import { render } from '../render.ts'
import { save, state, t, WIDE } from '../state.ts'
import { avatar, empty, listSkeleton, prioGlyph, problemState, statusGlyph, statusKind, statusLabel, swatch, moreButton, groupName, groupGlyph, shortDate, typeMark, epicColor, epicBar, doneWindow, olderDone } from '../ui.ts'

/** Rows drawn per list before "Show more": thousands of rows cost seconds to build. */
const PAGE = 100

/** How many rows each list shows, by list key; reset when the view changes. */
let shown: Record<string, number> = {}

/** Back to the first page of every list: a new tab, a new search, another workspace. */
export function resetShown() {
  shown = {}
}

/** `status: false` where the list already says the state (a status group, Ready): the glyph would repeat it. */
type RowOpts = { inEpic?: boolean; status?: boolean }

export function capped(key: string, list: Bead[], ready: Set<string>, { inEpic = false, status = true }: RowOpts = {}): Child[] {
  const n = shown[key] ?? PAGE
  const rest = list.length - n
  const more = () => {
    shown = { ...shown, [key]: n + PAGE * 5 }
    render({ focus: `more:${key}` })
  }
  return [
    list.slice(0, n).map(
      (b) => html`<${Row} key=${b.id} b=${b} ready=${ready} inEpic=${inEpic} status=${status} cursor=${state.cursor === b.id} started=${state.ui.launched[b.id]} />`
    ),
    rest > 0 ? moreButton(key, PAGE * 5, rest, more) : null
  ]
}

/** On arrival only what is moving is open; with nothing moving, what can start is. */
// In the big view there is room for everything but what is done.
const foldedByDefault = (key: string, doing: number) => (WIDE ? key === 'done' : !(key === 'doing' || (isCustom(key) && isDoing({ status: key })) || (key === 'todo' && doing === 0)))

export function listView() {
  const answer = shownList()
  if (!answer) return listSkeleton()
  if (answer.problem) return problemState(answer.problem, answer.error)
  const m = t()
  const ready = readySet()
  const q = state.ui.query.trim()
  if (q) {
    const found = search(q).sort(byWorkOrder)
    if (!found.length)
      return empty(ICON.search, m.noMatch(q), null, html`<button class="btn" type="button" onClick=${() => openCreate(null, 'task', q)}>${glyph(ICON.add)}${m.createNamed(q)}</button>`)
    return html`<div role="list" aria-label=${m.search}>${capped('search', found, ready)}</div>`
  }
  if (state.ui.tab === 'ready') {
    const list = answer.beads.filter((b) => ready.has(b.id)).sort(byPriority)
    if (!list.length) return empty(ICON.pause, m.nothingReady, m.nothingReadyHint)
    return html`<div role="list" aria-label=${m.ready}>${capped('ready', list, ready, { status: false })}</div>`
  }
  if (state.ui.tab === 'epics') return epicsView(ready)
  if (!answer.beads.length)
    return empty(ICON.layers, m.noBeads, m.noBeadsHint, html`<button class="btn" type="button" onClick=${() => openCreate(null)}>${glyph(ICON.add)}${m.newBead}</button>`)
  return statusGroups(answer.beads, ready)
}

/** Tasks grouped by state under folding headers: All in the panel, the list in the big view. */
export function statusGroups(beads: Bead[], ready: Set<string>) {
  const groups = sections(beads, ready).filter(([, list]) => list.length)
  const doingCount = groups.find(([key]) => key === 'doing')?.[1].length ?? 0
  return html`
    <div>
      ${groups.map(([key, list]) => {
        const shut = state.ui.collapsed[key] ?? foldedByDefault(key, doingCount)
        const toggle = () => {
          state.ui.collapsed = { ...state.ui.collapsed, [key]: !shut }
          render()
          save()
        }
        return html`
          <section key=${key} aria-label=${groupName(key)}>
            <button class="group-h" type="button" data-k=${`g:${key}`} aria-expanded=${String(!shut)} onClick=${toggle}>
              ${glyph(ICON.chevron, 'chev')}${groupGlyph(key)}${groupName(key)}
              <span class="num">${list.length}</span>${key === 'done' ? doneWindow() : null}
            </button>
            ${shut ? null : html`<div role="list">${capped(`g:${key}`, list, ready, { status: false })}</div>${key === 'done' ? olderDone() : null}`}
          </section>
        `
      })}
    </div>
  `
}

type RowProps = { b: Bead; ready: Set<string>; inEpic: boolean; status: boolean; cursor: boolean; started?: string }

/** One task: priority, short id, state, title, holder; a second line only when it says something. Redrawn only when its props change. */
const Row = memo(({ b, ready, inEpic, status, cursor, started }: RowProps) => {
  const m = t()
  const kind = statusKind(b, ready)
  const epic = inEpic ? null : epicFor(b)
  const launched = kind !== 'done' && kind !== 'doing' ? started : undefined
  const late = b.due_at && Date.parse(b.due_at) < Date.now()
  const meta = [
    // Without the glyph, what the group heading does not say is spelled out.
    !status && (kind === 'deferred' || kind === 'pinned') && !isCustom(b.status) ? html`<span class="state">${glyph(STATUS[kind], `st ${kind}`)}<span class="t">${statusLabel(b.status)}</span></span>` : null,
    epic ? html`<span class="chip">${swatch(epic.id)}<span class="t">${epic.title}</span></span>` : null,
    kind === 'waiting' && b.waits_on?.length
      ? html`<span class="waits" title=${m.waitsOn(b.waits_on.map(titleOf).join(', '))}><span class="t">${m.waitsOn(b.waits_on.map(shortId).join(', '))}</span></span>`
      : null,
    launched ? html`<span class="launched">${glyph(ICON.agent)}<span class="t">${m.launchedBy(launched)}</span></span>` : null,
    b.due_at && kind !== 'done'
      ? html`<span class=${`due${late ? ' late' : ''}`} title=${m.due}>
          ${glyph(ICON.calendar)}<span class="t">${shortDate(b.due_at)}</span>
        </span>`
      : null
  ].filter(Boolean)
  return html`
    <button
      class=${`row${kind === 'done' ? ' closed' : ''}${status ? '' : ' bare'}${cursor ? ' cursor' : ''}`}
      type="button"
      role="listitem"
      data-row=${b.id}
      data-k=${`row:${b.id}`}
      title=${`${b.id} · ${statusLabel(b.status)}`}
      onClick=${() => open(b.id)}
    >
      ${prioGlyph(b.priority)}
      <span class="id num">${shortId(b.id)}</span>
      ${status ? statusGlyph(b, ready) : null}
      <span class="title">
        ${typeMark(b.issue_type)}${b.title}
      </span>
      ${b.assignee ? avatar(b.assignee) : html`<span />`}
      ${meta.length ? html`<span class="meta">${meta}</span>` : null}
    </button>
  `
})

function epicsView(ready: Set<string>) {
  const m = t()
  const { epics, loose } = byEpic(beads())
  if (!epics.length)
    return empty(ICON.layers, m.noEpics, m.noEpicsHint, html`<button class="btn" type="button" onClick=${() => openCreate(null, 'epic')}>${glyph(ICON.add)}${m.newEpic}</button>`)
  const block = (key: string, head: Child, kids: Bead[], acts: Child) => {
    const isOpen = Boolean(state.ui.epicsOpen[key])
    const toggle = () => {
      state.ui.epicsOpen = { ...state.ui.epicsOpen, [key]: !isOpen }
      render()
      save()
    }
    return html`
      <section key=${key}>
        <button class="epic-h" type="button" data-k=${`e:${key}`} aria-expanded=${String(isOpen)} onClick=${toggle}>${glyph(ICON.chevron, 'chev')}${head}</button>
        ${isOpen ? [html`<div role="list">${capped(`e:${key}`, kids, ready, { inEpic: true })}</div>`, acts] : null}
      </section>
    `
  }
  return html`
    <div>
      ${epics.map(({ epic, children, done: loadedDone }) => {
        const { done, total } = epicProgress(epic.id, loadedDone, children.length)
        return block(
          epic.id,
          [
            html`<span style=${`color:${epicColor(epic.id)}`} aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICON.epic }} />`,
            html`<span class="title">${epic.title}</span>`,
            html`<span class="muted num">${total ? `${done}/${total}` : '0'}</span>`,
            total ? epicBar(epic, done, total) : null
          ],
          children,
          html`<div class="epic-acts">
            <button class="btn ghost sm" type="button" onClick=${() => open(epic.id)}>${glyph(ICON.layers)}${m.epicDetail}</button>
            <button class="btn ghost sm" type="button" onClick=${() => openCreate({ id: epic.id, title: epic.title })}>${glyph(ICON.add)}${m.addBead}</button>
          </div>`
        )
      })}
      ${loose.length
        ? block(
            '__none',
            [html`<span class="muted" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICON.layers }} />`, html`<span class="title">${m.noEpic}</span>`, html`<span class="muted num">${loose.length}</span>`],
            loose,
            null
          )
        : null}
    </div>
  `
}
