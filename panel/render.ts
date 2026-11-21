// Drawing the panel: one App component, redrawn from the state after every change. Preact only
// touches what differs, so focus, carets and scroll stay where they are.
import { byWorkOrder } from '../src/model.ts'
import { ICON } from './glyphs.ts'
import { back, newMemory, open, openCreate, openMemory } from './actions.ts'
import { beads, lookups, readySet, search } from './data.ts'
import { glyph, html, valueOf } from './dom.ts'
import { Menu } from './menu.ts'
import { routeOf, save, state, t } from './state.ts'
import type { Route } from './state.ts'
import { Toast } from './toast.ts'
import { ago } from './ui.ts'
import { render as draw } from './vendor/preact.js'
import { detailView } from './views/detail.ts'
import { formView } from './views/forms.ts'
import { listView, resetShown } from './views/list.ts'
import { memoryView } from './views/memory.ts'

type RenderOpts = { top?: boolean; focus?: string }

/** Draws the panel from the state; `top` scrolls the view back up, `focus` focuses the element with that `data-k`. */
export function render({ top = false, focus }: RenderOpts = {}) {
  draw(html`<${App} />`, document.getElementById('app')!)
  if (top) document.getElementById('view')!.scrollTop = 0
  if (focus) document.querySelector<HTMLElement>(`[data-k="${CSS.escape(focus)}"]`)?.focus()
}

const VIEWS: Record<Route, () => unknown> = { list: listView, detail: detailView, memory: memoryView, form: formView }

function App() {
  const route = routeOf()
  return html`
    <${Header} route=${route} />
    <main>
      <div id="view" class="scroll" style=${{ '--idw': `${lookups().idWidth}ch` }}>${VIEWS[route]()}</div>
      <div id="toast" aria-live="polite"><${Toast} /></div>
    </main>
    <${Footer} route=${route} />
    ${state.menu ? html`<${Menu} key=${state.menu.seq} ...${state.menu} />` : null}
  `
}

function Header({ route }: { route: Route }) {
  const m = t()
  const ok = Boolean(state.list && !state.list.problem)
  // Shown while the list loads too, so nothing moves when it arrives.
  const usable = !state.list?.problem
  const onMemory = route === 'memory'
  return html`
    <header>
      <div class="bar">
        <div class="brand"><b>Beads</b><span id="ws">${state.ws ? (state.ws.split('/').filter(Boolean).pop() ?? '') : ''}</span></div>
        <button
          class="ib"
          id="mem"
          type="button"
          hidden=${!ok}
          aria-label=${m.memory}
          aria-pressed=${String(onMemory)}
          title=${`${m.memoryHint} (m)`}
          onClick=${() => (onMemory ? back() : openMemory())}
          dangerouslySetInnerHTML=${{ __html: ICON.brain }}
        />
        <button
          class="ib"
          id="new"
          type="button"
          hidden=${route === 'form' || !ok}
          aria-label=${onMemory ? m.newMemory : m.newBead}
          title=${onMemory ? m.newMemory : `${m.newBead} (n)`}
          onClick=${() => (onMemory ? newMemory() : openCreate(null))}
          dangerouslySetInnerHTML=${{ __html: ICON.add }}
        />
      </div>
      <div class="search" id="searchbox" hidden=${route !== 'list' || !usable}>
        ${glyph(ICON.search)}
        <input id="q" type="search" autocomplete="off" spellcheck=${false} placeholder=${m.searchPlaceholder} aria-label=${m.search} value=${state.ui.query} onInput=${onSearch} onKeyDown=${onSearchKey} />
        <kbd aria-hidden="true">/</kbd>
      </div>
      <${Tabs} hidden=${route !== 'list' || !usable || Boolean(state.ui.query.trim())} />
    </header>
  `
}

function onSearch(e: Event) {
  resetShown()
  state.ui.query = valueOf(e)
  state.cursor = null
  render({ top: true })
  save()
}

function onSearchKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    // Down from the search moves into the list, like j.
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).blur()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }))
    return
  }
  // Enter opens the first match, or creates the task when nothing matches.
  const q = state.ui.query.trim()
  if (e.key !== 'Enter' || !q) return
  const found = search(q).sort(byWorkOrder)
  if (found.length) open(found[0].id)
  else openCreate(null, 'task', q)
}

function Tabs({ hidden }: { hidden: boolean }) {
  const m = t()
  const all = beads()
  const ready = readySet()
  const tabs = [
    ['all', m.all, all.length],
    ['ready', m.ready, all.filter((b) => ready.has(b.id)).length],
    ['epics', m.epics, all.filter((b) => b.issue_type === 'epic').length]
  ] as const
  const select = (id: (typeof tabs)[number][0]) => () => {
    state.ui.tab = id
    resetShown()
    state.cursor = null
    render({ top: true })
    save()
  }
  return html`
    <div class="tabs" id="tabs" role="tablist" hidden=${hidden}>
      ${tabs.map(
        ([id, label, count]) => html`<button key=${id} class="tab" role="tab" type="button" aria-selected=${String(state.ui.tab === id)} onClick=${select(id)}>
          ${label}${state.list ? html`<span class="num">${count}</span>` : null}
        </button>`
      )}
    </div>
  `
}

function Footer({ route }: { route: Route }) {
  const m = t()
  const stale = state.loadedAt && Date.now() - state.loadedAt > 5 * 60_000
  const keys =
    route === 'list'
      ? [['/', m.hintSearch], ['n', m.hintNew], ['r', m.hintRefresh]]
      : route === 'memory'
        ? [['/', m.hintSearch], ['n', m.hintNew], ['esc', m.back.toLowerCase()]]
        : [['esc', m.back.toLowerCase()]]
  return html`
    <footer id="foot">
      ${state.reloading
        ? html`<span class="spinner" aria-hidden="true" /><span>${m.reloading}</span>`
        : state.loadedAt
          ? html`<span class=${`dot${stale ? ' stale' : ''}`} aria-hidden="true" /><span>${m.updatedAt(ago(state.loadedAt))}</span>`
          : null}
      <span class="keys" aria-hidden="true">${keys.map(([k, label]) => html`<span key=${k}><kbd>${k}</kbd>${label}</span>`)}</span>
    </footer>
  `
}
