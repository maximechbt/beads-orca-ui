// The board, in the big view: one column per state, a card per task; dropping a card on a column changes its state.
import { byWorkOrder, sections } from '../../src/model.ts'
import type { SectionKey } from '../../src/model.ts'
import { ICON } from '../glyphs.ts'
import { open } from '../actions.ts'
import { act, epicFor, readySet, shortId } from '../data.ts'
import { glyph, html, memo } from '../dom.ts'
import { render } from '../render.ts'
import { state, t } from '../state.ts'
import { avatar, prioGlyph, swatch, groupName, groupGlyph, moreButton, typeMark, shortDate, doneWindow, olderDone } from '../ui.ts'

/** Cards drawn per column before "Show more"; Done can hold thousands. */
const PAGE = 50
let shown: Partial<Record<SectionKey, number>> = {}
/** The card being dragged, and the column it hovers. */
let dragging: { id: string; from: SectionKey } | null = null
let over: SectionKey | null = null

/** What dropping a task on a column asks bd: start it, put it back, hold it, finish it. */
function moveTo(id: string, to: SectionKey) {
  const m = t()
  if (to === 'doing') return act({ id, action: 'claim' }, m.statusChanged)
  if (to === 'done') return act({ id, action: 'close', reason: '' }, m.closed)
  // Todo is open again; Waiting is blocked; a custom status's column is that status.
  return act({ id, action: 'status', value: to === 'todo' ? 'open' : to }, m.statusChanged)
}

/** `scope`: the tasks the search and filters keep. */
export function boardView(scope: Bead[]) {
  const m = t()
  const ready = readySet()
  // Todo first, as work flows left to right.
  const groups = sections(scope.filter((b) => b.issue_type !== 'epic'), ready, true)
  return html`
    <div class="board">
      ${groups.map(([key, cards]) => {
        const list = cards.sort(key === 'done' ? () => 0 : byWorkOrder)
        const n = shown[key] ?? PAGE
        const drop = (e: DragEvent) => {
          e.preventDefault()
          const d = dragging
          dragging = over = null
          if (d && d.from !== key) moveTo(d.id, key)
          else render()
        }
        return html`
          <section
            key=${key}
            class=${`col${over === key && dragging?.from !== key ? ' over' : ''}`}
            aria-label=${groupName(key)}
            onDragOver=${(e: DragEvent) => {
              e.preventDefault()
              if (over !== key) ((over = key), render())
            }}
            onDrop=${drop}
          >
            <h2 class="col-h">${groupGlyph(key)}${groupName(key)}<span class="num">${list.length}</span>${key === 'done' ? doneWindow() : null}</h2>
            <div class="cards" role="list">
              ${list.length ? list.slice(0, n).map((b) => html`<${Card} key=${b.id} b=${b} col=${key} on=${state.ui.openId === b.id} />`) : html`<p class="col-empty">${m.dropHere}</p>`}
              ${list.length > n ? moreButton(`col:${key}`, PAGE * 4, list.length - n, () => ((shown = { ...shown, [key]: n + PAGE * 4 }), render())) : null}
              ${key === 'done' ? olderDone() : null}
            </div>
          </section>
        `
      })}
    </div>
  `
}

/** One task as a card: id and holder on top, the title, then what places it (priority, epic, labels, due date). */
const Card = memo(({ b, col, on }: { b: Bead; col: SectionKey; on: boolean }) => {
  const epic = epicFor(b)
  const late = b.due_at && col !== 'done' && Date.parse(b.due_at) < Date.now()
  return html`
    <button
      class=${`card${on ? ' on' : ''}${col === 'done' ? ' closed' : ''}`}
      type="button"
      role="listitem"
      draggable="true"
      data-row=${b.id}
      onDragStart=${(e: DragEvent) => {
        dragging = { id: b.id, from: col }
        e.dataTransfer?.setData('text/plain', b.id)
      }}
      onDragEnd=${() => ((dragging = over = null), render())}
      onClick=${() => open(b.id)}
    >
      <span class="card-top"><span class="id num">${shortId(b.id)}</span>${b.assignee ? avatar(b.assignee) : null}</span>
      <span class="card-title">
        ${typeMark(b.issue_type === 'bug' ? 'bug' : undefined)}${b.title}
      </span>
      <span class="card-meta">
        ${prioGlyph(b.priority)}
        ${epic ? html`<span class="chip">${swatch(epic.id)}<span class="t">${epic.title}</span></span>` : null}
        ${(b.labels ?? []).slice(0, 2).map((l) => html`<span key=${l} class="chip"><span class="t">${l}</span></span>`)}
        ${b.due_at && col !== 'done'
          ? html`<span class=${`due${late ? ' late' : ''}`}>${glyph(ICON.calendar)}${shortDate(b.due_at)}</span>`
          : null}
      </span>
    </button>
  `
})
