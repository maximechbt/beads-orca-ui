// The popup menus behind every property, the … button and the pickers.
import { ICON } from './glyphs.ts'
import { glyph, html, valueOf } from './dom.ts'
import { render } from './render.ts'
import { state, t } from './state.ts'
import { useLayoutEffect, useRef, useState } from './vendor/preact.js'

/** One entry, or a separator line. */
export type MenuItem = { label: string; run: () => unknown; icon?: string; iconClass?: string; hint?: string; check?: boolean } | 'sep'

/** `search` adds a filter field; `create` turns what was typed into an item, for values no list holds: a name, a label, a date. */
export type MenuOpts = { search?: boolean; placeholder?: string; create?: (q: string) => MenuItem | null }

export type OpenMenu = { seq: number; anchor: HTMLElement; anchorKey?: string; items: MenuItem[]; opts: MenuOpts }

let seq = 0

/** Opens a menu under `anchor`, replacing any open one. */
export function openMenu(anchor: HTMLElement, items: MenuItem[], opts: MenuOpts = {}) {
  state.menu = { seq: ++seq, anchor, anchorKey: anchor.dataset.k, items, opts }
  render()
}

/** Closes the menu and gives the focus back to what opened it. */
export function closeMenu() {
  if (!state.menu) return
  const key = state.menu.anchorKey
  state.menu = null
  render()
  if (key) document.querySelector<HTMLElement>(`[data-k="${CSS.escape(key)}"]`)?.focus()
}

/** Whether the menu opened by the element with this `data-k` is open, for its aria-expanded. */
export const isOpen = (k: string) => state.menu?.anchorKey === k

/** A menu over thousands of tasks draws the first ones; typing narrows the rest. */
const MAX = 100

/** Arrows move, Enter picks, Esc closes. */
export function Menu({ anchor, items, opts }: OpenMenu) {
  const m = t()
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement | null>(null)
  const filter = opts.search || opts.create
  const lower = q.toLowerCase()
  const found = items.filter((it) => (it === 'sep' ? !q : !q || it.label.toLowerCase().includes(lower) || it.hint?.toLowerCase().includes(lower)))
  const typed = q.trim() && opts.create ? opts.create(q.trim()) : null
  const all = typed ? [typed, ...found] : found
  const visible = all.slice(0, MAX)
  const count = (list: MenuItem[]) => list.filter((it) => it !== 'sep').length
  const hidden = count(all) - count(visible)

  // Under its anchor, or above it when it would not fit below; inside the panel either way.
  useLayoutEffect(() => {
    const el = box.current!
    const r = anchor.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`
    if (below < el.offsetHeight + 12 && r.top > below) el.style.bottom = `${window.innerHeight - r.top + 4}px`
    else el.style.top = `${r.bottom + 4}px`
    el.querySelector<HTMLElement>('input, .mi')?.focus()
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    const entries = [...box.current!.querySelectorAll<HTMLElement>('.mi')]
    const i = entries.indexOf(document.activeElement as HTMLElement)
    const input = box.current!.querySelector<HTMLElement>('input')
    if (e.key === 'ArrowDown') entries[(i + 1) % entries.length]?.focus()
    else if (e.key === 'ArrowUp') (i <= 0 ? (input ?? entries[entries.length - 1]) : entries[i - 1])?.focus()
    else if (e.key === 'Escape' || e.key === 'Tab') closeMenu()
    else return
    e.preventDefault()
    e.stopPropagation()
  }
  const pick = (run: () => unknown) => () => {
    closeMenu()
    run()
  }

  return html`
    <div class="menu" role="menu" ref=${box} onKeyDown=${onKeyDown}>
      ${filter
        ? html`<input
            aria-label=${opts.placeholder ?? m.search}
            placeholder=${opts.placeholder ?? m.search}
            value=${q}
            onInput=${(e: Event) => setQ(valueOf(e))}
            onKeyDown=${(e: KeyboardEvent) => e.key === 'Enter' && box.current!.querySelector<HTMLElement>('.mi')?.click()}
          />`
        : null}
      <div>
        ${count(visible)
          ? visible.map((it, i) =>
              it === 'sep'
                ? html`<div key=${`sep${i}`} class="sep" role="separator" />`
                : html`<button key=${`${i}:${it.label}`} class="mi" type="button" role="menuitem" onClick=${pick(it.run)}>
                    ${it.icon ? glyph(it.icon, it.iconClass ?? 'muted') : null}
                    <span class="t">${it.label}</span>
                    ${it.hint ? html`<span class="kbd num">${it.hint}</span>` : null}
                    ${it.check ? glyph(ICON.check, 'check') : null}
                  </button>`
            )
          : html`<div class="none">${m.noMatch(q)}</div>`}
        ${hidden > 0 ? html`<div class="none">${m.typeToNarrow(hidden)}</div>` : null}
      </div>
    </div>
  `
}

document.addEventListener('mousedown', (e) => {
  if (state.menu && !(e.target as Element).closest?.('.menu')) closeMenu()
})
