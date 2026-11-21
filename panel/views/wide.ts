// The big view's own pieces: its header (view tabs, search), its filter chips, the Epics view, and which view shows.
import { byPriority, byEpic, byWorkOrder, isDone, sectionKeys, sectionOf } from '../../src/model.ts'
import type { SectionKey } from '../../src/model.ts'
import { ICON, PRIORITY, STATUS } from '../glyphs.ts'
import { back, open, openCreate, toggleMemory, newHere } from '../actions.ts'
import { beads, epicFor, readySet, search, shownList, epicProgress } from '../data.ts'
import { anchorOf, glyph, html } from '../dom.ts'
import { isOpen, openMenu } from '../menu.ts'
import type { MenuItem } from '../menu.ts'
import { render } from '../render.ts'
import { save, state, t } from '../state.ts'
import type { Route } from '../state.ts'
import { empty, listSkeleton, problemState, epicColor, groupGlyph, groupIcon, groupName, epicBar, wsName } from '../ui.ts'
import { boardView } from './board.ts'
import { capped, statusGroups } from './list.ts'

export type Filters = { status?: SectionKey; priority?: number; assignee?: string; label?: string; epic?: string; ready?: boolean }
export type WideView = 'list' | 'board' | 'epics'

/** The tasks the filters keep; an empty string asks for none (nobody assigned, no epic). */
export function applyFilters(list: Bead[]): Bead[] {
  const f = state.ui.filters
  const ready = readySet()
  return list.filter(
    (b) =>
      (f.status === undefined || sectionOf(b, ready) === f.status) &&
      (f.priority === undefined || b.priority === f.priority) &&
      (f.assignee === undefined || (b.assignee ?? '') === f.assignee) &&
      (f.label === undefined || (b.labels ?? []).includes(f.label)) &&
      (f.epic === undefined || (epicFor(b)?.id ?? '') === f.epic) &&
      (!f.ready || ready.has(b.id))
  )
}

const setFilter = (patch: Filters) => {
  state.ui.filters = { ...state.ui.filters, ...patch }
  for (const k of Object.keys(patch) as (keyof Filters)[]) if (patch[k] === undefined) delete state.ui.filters[k]
  render({ top: true })
  save()
}

/** The view the tab shows: the chosen one over what the search and filters keep. */
export function wideView() {
  const answer = shownList()
  if (!answer) return listSkeleton()
  if (answer.problem) return problemState(answer.problem, answer.error)
  const m = t()
  const q = state.ui.query.trim()
  const scope = applyFilters(q ? search(q) : beads())
  const filtered = Object.keys(state.ui.filters).length > 0
  if (!scope.length && (q || filtered))
    return empty(ICON.search, q ? m.noMatch(q) : m.noFilterMatch, null, [
      filtered ? html`<button class="btn" type="button" onClick=${() => setFilter(clearAll())}>${m.clearFilters}</button>` : null,
      q ? html`<button class="btn" type="button" onClick=${() => openCreate(null, 'task', q)}>${glyph(ICON.add)}${m.createNamed(q)}</button>` : null
    ])
  if (!scope.length)
    return empty(ICON.layers, m.noBeads, m.noBeadsHint, html`<button class="btn" type="button" onClick=${() => openCreate(null)}>${glyph(ICON.add)}${m.newBead}</button>`)
  if (state.ui.view === 'board') return boardView(scope)
  if (state.ui.view === 'epics') return epicsWide(scope)
  return q ? html`<div role="list" aria-label=${m.search}>${capped('search', scope.sort(byWorkOrder), readySet())}</div>` : statusGroups(scope, readySet())
}

const clearAll = (): Filters => ({ status: undefined, priority: undefined, assignee: undefined, label: undefined, epic: undefined, ready: undefined })

/** One section per epic: its progress, how its tasks split by state, then the tasks the filters keep. */
function epicsWide(scope: Bead[]) {
  const m = t()
  const ready = readySet()
  const kept = new Set(scope.map((b) => b.id))
  const { epics, loose } = byEpic(beads())
  const filtered = Object.keys(state.ui.filters).length > 0 || Boolean(state.ui.query.trim())
  const block = (key: string, head: unknown, kids: Bead[]) => html`
    <section key=${key} class="epic-block">
      ${head}
      ${kids.length ? html`<div role="list">${capped(`ew:${key}`, kids, ready, { inEpic: true })}</div>` : html`<p class="empty-line epic-empty">${m.noChildren}</p>`}
    </section>
  `
  return html`
    <div class="epics-wide">
      ${epics
        .filter(({ epic, children }) => !filtered || kept.has(epic.id) || children.some((c) => kept.has(c.id)))
        .map(({ epic, children, done: loadedDone }) => {
          const kids = children.filter((c) => kept.has(c.id))
          const { done, total } = epicProgress(epic.id, loadedDone, children.length)
          const counts = sectionKeys(true)
            .filter((k) => k !== 'done' && !isDone({ status: k }))
            .map((k) => [k, children.filter((c) => sectionOf(c, ready) === k).length] as const)
            .filter(([, n]) => n)
          return block(
            epic.id,
            html`<div class="epic-head">
              <button class="epic-title" type="button" onClick=${() => open(epic.id)}>
                <span style=${`color:${epicColor(epic.id)}`} aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICON.epic }} />
                <span class="t">${epic.title}</span>
              </button>
              <span class="epic-counts">
                ${counts.map(([k, n]) => html`<span key=${k} title=${groupName(k)}>${groupGlyph(k)}${n}</span>`)}
              </span>
              <span class="epic-progress">${epicBar(epic, done, total)}<span class="num">${total ? `${done}/${total}` : '0'}</span></span>
              <button class="btn ghost sm" type="button" onClick=${() => openCreate({ id: epic.id, title: epic.title })}>${glyph(ICON.add)}${m.addBead}</button>
            </div>`,
            kids
          )
        })}
      ${loose.some((b) => kept.has(b.id))
        ? block(
            '__none',
            html`<div class="epic-head"><span class="epic-title"><span class="muted" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICON.layers }} /><span class="t">${m.noEpic}</span></span></div>`,
            loose.filter((b) => kept.has(b.id))
          )
        : null}
    </div>
  `
}

/** The big view's header: where you are, the three views, search, memory and new. */
export function WideHeader({ route, onSearch, onSearchKey }: { route: Route; onSearch: (e: Event) => void; onSearchKey: (e: KeyboardEvent) => void }) {
  const m = t()
  const ok = Boolean(state.list && !state.list.problem)
  const onMemory = route === 'memory'
  const views: [WideView, string, string][] = [
    ['list', m.listView, ICON.rows],
    ['board', m.boardView, ICON.columns],
    ['epics', m.epics, ICON.epic]
  ]
  const pick = (v: WideView) => () => {
    state.ui.view = v
    if (route !== 'list') back()
    render({ top: true })
    save()
  }
  return html`
    <header class="wide-h">
      <div class="bar">
        <div class="brand"><b>Beads</b><span>${wsName()}</span></div>
        <nav class="views" role="tablist" aria-label=${m.layout}>
          ${views.map(
            ([v, label, icon]) => html`<button key=${v} class="view" role="tab" type="button" aria-selected=${String(route === 'list' && state.ui.view === v)} onClick=${pick(v)}>
              ${glyph(icon)}${label}
            </button>`
          )}
        </nav>
        <div class="search" hidden=${!ok}>
          ${glyph(ICON.search)}
          <input id="q" type="search" autocomplete="off" spellcheck=${false} placeholder=${m.searchPlaceholder} aria-label=${m.search} value=${state.ui.query} onInput=${onSearch} onKeyDown=${onSearchKey} />
          <kbd aria-hidden="true">/</kbd>
        </div>
        <button class="ib" type="button" hidden=${!ok} aria-label=${m.memory} aria-pressed=${String(onMemory)} title=${`${m.memoryHint} (m)`} onClick=${toggleMemory} dangerouslySetInnerHTML=${{ __html: ICON.brain }} />
        <button class="btn primary sm" type="button" hidden=${route === 'form' || !ok} title=${onMemory ? m.newMemory : `${m.newBead} (n)`} onClick=${newHere}>
          ${glyph(ICON.add)}${onMemory ? m.newMemory : m.newBead}
        </button>
      </div>
      ${route === 'list' && ok ? html`<${FilterBar} />` : null}
    </header>
  `
}

/** What the current view shows, out of all it could: the board leaves epics out, so it counts without them. */
function count() {
  const q = state.ui.query.trim()
  const pool = state.ui.view === 'board' ? beads().filter((b) => b.issue_type !== 'epic') : beads()
  return t().shownCount(applyFilters(q ? search(q).filter((b) => pool.includes(b)) : pool).length, pool.length)
}

/** One chip per filter: its name, or its value once set with a × to drop it. */
function FilterBar() {
  const m = t()
  const f = state.ui.filters
  const all = beads()
  const ready = readySet()
  const people = [...new Set(all.map((b) => b.assignee).filter((x): x is string => Boolean(x)))].sort()
  const labels = [...new Set(all.flatMap((b) => b.labels ?? []))].sort()
  const epics = all.filter((b) => b.issue_type === 'epic').sort(byPriority)
  const epicTitle = (id: string) => epics.find((e) => e.id === id)?.title ?? id
  const chip = (key: string, label: string, value: string | null, items: () => MenuItem[], clear: Filters, search = false) =>
    html`<span key=${key} class=${`fchip${value === null ? '' : ' on'}`}>
      <button
        type="button"
        data-k=${`f:${key}`}
        aria-haspopup="menu"
        aria-expanded=${String(isOpen(`f:${key}`))}
        onClick=${(e: Event) => openMenu(anchorOf(e), items(), { search })}
      >
        <span class="fname">${label}</span>${value === null ? glyph(ICON.down, 'down') : html`<span class="fval">${value}</span>`}
      </button>
      ${value === null ? null : html`<button type="button" class="x" aria-label=${`${m.clear} ${label}`} onClick=${() => setFilter(clear)} dangerouslySetInnerHTML=${{ __html: ICON.close }} />`}
    </span>`
  const active = Object.keys(f).length
  return html`
    <div class="filters" role="toolbar" aria-label=${m.filters}>
      ${chip(
        'status',
        m.status_,
        f.status ? groupName(f.status) : null,
        () =>
          sectionKeys(true).map((k) => ({
            label: `${groupName(k)}  ${all.filter((b) => sectionOf(b, ready) === k).length}`,
            ...groupIcon(k),
            check: f.status === k,
            run: () => setFilter({ status: k })
          })),
        { status: undefined }
      )}
      ${chip(
        'priority',
        m.priority,
        f.priority === undefined ? null : (m.priorities[f.priority] ?? `P${f.priority}`),
        () => m.priorities.map((label, i) => ({ label, icon: PRIORITY[i], iconClass: `prio p${i}`, check: f.priority === i, run: () => setFilter({ priority: i }) })),
        { priority: undefined }
      )}
      ${chip(
        'assignee',
        m.assignee,
        f.assignee === undefined ? null : f.assignee || m.nobody,
        () => [
          ...people.map((p) => ({ label: p, icon: ICON.user, check: f.assignee === p, run: () => setFilter({ assignee: p }) })),
          'sep' as const,
          { label: m.nobody, check: f.assignee === '', run: () => setFilter({ assignee: '' }) }
        ],
        { assignee: undefined },
        people.length > 8
      )}
      ${labels.length
        ? chip(
            'label',
            m.labels,
            f.label ?? null,
            () => labels.map((l) => ({ label: l, check: f.label === l, run: () => setFilter({ label: l }) })),
            { label: undefined },
            labels.length > 8
          )
        : null}
      ${epics.length
        ? chip(
            'epic',
            m.epic,
            f.epic === undefined ? null : f.epic ? epicTitle(f.epic) : m.noEpic,
            () => [
              ...epics.map((e) => ({ label: e.title, icon: ICON.epic, check: f.epic === e.id, run: () => setFilter({ epic: e.id }) })),
              'sep' as const,
              { label: m.noEpic, check: f.epic === '', run: () => setFilter({ epic: '' }) }
            ],
            { epic: undefined },
            epics.length > 8
          )
        : null}
      <button key="ready" type="button" class=${`fchip toggle${f.ready ? ' on' : ''}`} aria-pressed=${String(Boolean(f.ready))} onClick=${() => setFilter({ ready: f.ready ? undefined : true })}>
        ${glyph(STATUS.open, 'st open')}${m.readyOnly}
      </button>
      ${active ? html`<button key="clear" type="button" class="btn ghost sm" onClick=${() => setFilter(clearAll())}>${m.clearFilters}</button>` : null}
      <span class="fcount num">${count()}</span>
    </div>
  `
}
