// The Beads panel. It talks only to its own worker (`orca.plugin.request`), which runs `bd`.
// Everything bd returns is untrusted text: Preact puts it in the page as text, never as markup.
// This file wires the keyboard, the pointer and Orca's events, then starts the panel.
import { back, newMemory, open, openCreate, openMemory } from './actions.ts'
import { loadTargets, prefetch, refresh, switchWorkspace } from './data.ts'
import { searchBox } from './dom.ts'
import { closeMenu } from './menu.ts'
import { render } from './render.ts'
import { restore, routeOf, save, state, WIDE } from './state.ts'

const typing = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)

/** Esc steps back one level: a menu, a search, a confirmation, a field, then the view itself. */
function escape() {
  const active = document.activeElement as HTMLElement | null
  if (state.menu) return closeMenu()
  if (active?.dataset.k === 'mem:q' && state.memQuery) {
    state.memQuery = ''
    return render()
  }
  if (active === searchBox() && state.ui.query) {
    state.ui.query = ''
    render()
    return save()
  }
  if (state.closing || state.releasing || state.deleting || state.memEdit || state.forgetting) {
    state.closing = state.releasing = state.deleting = state.memEdit = state.forgetting = null
    return render()
  }
  if (typing(active)) return active.blur()
  if (state.ui.form || state.ui.openId) back()
}

/** j and k move a cursor through the rows on screen; it reads ahead the task it lands on. */
function moveCursor(down: boolean) {
  const rows = [...document.querySelectorAll<HTMLElement>('#view [data-row]')].map((r) => r.dataset.row!)
  if (!rows.length) return
  const i = state.cursor ? rows.indexOf(state.cursor) : -1
  state.cursor = rows[i < 0 ? (down ? 0 : rows.length - 1) : Math.min(Math.max(i + (down ? 1 : -1), 0), rows.length - 1)]
  render()
  document.querySelector(`[data-row="${CSS.escape(state.cursor)}"]`)?.scrollIntoView({ block: 'nearest' })
  prefetch(state.cursor)
}

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'Escape') return escape()
  if (typing(document.activeElement)) return
  const route = routeOf()
  const listed = Boolean(state.list && !state.list.problem)
  if (e.key === '/' && route === 'memory') {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('[data-k="mem:q"]')?.focus()
  } else if (e.key === '/' && route === 'list' && listed) {
    e.preventDefault()
    searchBox().focus()
    searchBox().select()
  } else if (e.key === 'r') refresh(true)
  else if (e.key === 'n' && route === 'memory') newMemory()
  else if (e.key === 'm' && route !== 'form' && listed) route === 'memory' ? back() : openMemory()
  else if (e.key === 'n' && route !== 'form' && listed) openCreate(null)
  else if (['j', 'k', 'ArrowDown', 'ArrowUp'].includes(e.key) && route === 'list') {
    e.preventDefault()
    moveCursor(e.key === 'j' || e.key === 'ArrowDown')
  } else if (e.key === 'Enter' && route === 'list' && state.cursor && !document.activeElement?.closest?.('button')) open(state.cursor)
})

// Reading ahead: a short hover (a pointer passing over does not count), or keyboard focus.
let hoverTimer: ReturnType<typeof setTimeout> | undefined
const aheadOf = (t: EventTarget | null) => (t as Element | null)?.closest?.<HTMLElement>('[data-row],[data-ahead]')
const aheadId = (el: HTMLElement) => el.dataset.row ?? el.dataset.ahead!

document.addEventListener('pointerover', (e) => {
  const el = aheadOf(e.target)
  clearTimeout(hoverTimer)
  if (el) hoverTimer = setTimeout(() => prefetch(aheadId(el)), 120)
})
document.addEventListener('pointerout', () => clearTimeout(hoverTimer))
document.addEventListener('focusin', (e) => {
  const el = aheadOf(e.target)
  if (el) prefetch(aheadId(el))
})

orca.on?.('workspace.changed', () => {
  void switchWorkspace()
  if (state.ui.form?.kind === 'launch') void loadTargets()
})

// Agents are what move tasks around: reload when one changes state.
orca.on?.('agent.status.changed', refresh)

// The footer's "updated 2 minutes ago".
setInterval(() => !state.reloading && render(), 30_000)

async function start() {
  if (WIDE) {
    // An editor is expected to read its document; the board file is only its way into Orca's middle, empty.
    orca.document?.get().catch(() => {})
  }
  await restore()
  render()
  refresh()
  if (state.ui.form?.kind === 'launch') void loadTargets()
}

start()
