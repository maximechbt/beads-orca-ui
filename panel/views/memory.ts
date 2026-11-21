// The workspace's beads memory: the facts every agent gets when its session starts.
import { ICON } from '../glyphs.ts'
import { markdown } from '../markdown.ts'
import { newMemory } from '../actions.ts'
import { forgetMemory, saveMemory } from '../data.ts'
import { anchorOf, glyph, html, valueOf } from '../dom.ts'
import { openMenu } from '../menu.ts'
import { render } from '../render.ts'
import { state, t } from '../state.ts'
import { copy, openLink } from '../toast.ts'
import { empty, memorySkeleton, problemState, topbar } from '../ui.ts'

type Memory = { key: string; value: string }
type Draft = NonNullable<typeof state.memEdit>

/** The facts `bd prime` hands every agent at start: read, add, rewrite, forget. */
export function memoryView() {
  const m = t()
  const answer = state.memories
  const q = state.memQuery.trim().toLowerCase()
  const list = (answer?.memories ?? []).filter((x) => !q || `${x.key} ${x.value}`.toLowerCase().includes(q))
  const onSearch = (e: Event) => {
    state.memQuery = valueOf(e)
    render()
  }
  return html`
    <div>
      ${topbar(html`<span class="here">${m.memory}</span>`)}
      <div class="doc">
        ${
          // With no memory yet, the empty state says it better.
          answer?.memories.length ? html`<p class="mem-intro">${m.memoryIntro}</p>` : null
        }
        ${!answer
          ? memorySkeleton()
          : answer.problem
            ? problemState(answer.problem, answer.error)
            : html`
                ${answer.memories.length
                  ? html`<div class="search">
                      ${glyph(ICON.search)}
                      <input type="search" data-k="mem:q" aria-label=${m.searchMemories} placeholder=${m.searchMemories} value=${state.memQuery} onInput=${onSearch} />
                      <kbd aria-hidden="true">/</kbd>
                    </div>`
                  : null}
                ${state.memEdit?.key === null ? editor(state.memEdit) : null}
                ${answer.memories.length === 0 && !state.memEdit
                  ? empty(ICON.brain, m.noMemories, m.noMemoriesHint, html`<button class="btn" type="button" onClick=${newMemory}>${glyph(ICON.add)}${m.newMemory}</button>`)
                  : list.length === 0 && q
                    ? html`<p class="empty-line">${m.noMemoryMatch(state.memQuery.trim())}</p>`
                    : list.map(item)}
              `}
      </div>
    </div>
  `
}

/** Writing a memory: its text, and for a new one an optional key. */
function editor(draft: Draft) {
  const m = t()
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    saveMemory()
  }
  const set = (key: 'value' | 'newKey') => (e: Event) => {
    draft[key] = valueOf(e)
    render()
  }
  return html`
    <div class="sheet">
      <textarea class="textarea" data-k="mem:value" aria-label=${m.memory} rows="3" placeholder=${m.memoryPlaceholder} value=${draft.value} onInput=${set('value')} onKeyDown=${onKeyDown} />
      ${draft.key === null ? html`<input class="input" data-k="mem:key" aria-label=${m.memoryKey} placeholder=${m.memoryKey} value=${draft.newKey} onInput=${set('newKey')} />` : null}
      <div class="row-btns">
        <button class="btn primary" type="button" disabled=${state.busy || !draft.value.trim()} onClick=${saveMemory}>${glyph(ICON.check)}${m.save}</button>
        <button class="btn ghost" type="button" onClick=${() => ((state.memEdit = null), render())}>${m.cancel}</button>
      </div>
    </div>
  `
}

function item(x: Memory) {
  const m = t()
  if (state.memEdit?.key === x.key) return html`<div key=${x.key} class="mem"><div class="mem-key num">${x.key}</div>${editor(state.memEdit)}</div>`
  if (state.forgetting === x.key)
    return html`
      <div key=${x.key} class="mem">
        <div class="sheet danger">
          <span>${m.forgetConfirm(x.key)}</span>
          <div class="row-btns">
            <button class="btn danger-solid" type="button" data-k="forget:go" disabled=${state.busy} onClick=${() => forgetMemory(x.key)}>${glyph(ICON.delete)}${m.forget}</button>
            <button class="btn ghost" type="button" onClick=${() => ((state.forgetting = null), render())}>${m.cancel}</button>
          </div>
        </div>
      </div>
    `
  const edit = () => {
    state.memEdit = { key: x.key, value: x.value, newKey: '' }
    state.forgetting = null
    render({ focus: 'mem:value' })
  }
  const forget = () => {
    state.forgetting = x.key
    state.memEdit = null
    render({ focus: 'forget:go' })
  }
  const menu = (e: Event) =>
    openMenu(anchorOf(e), [
      { label: m.edit, icon: ICON.edit, run: edit },
      { label: m.copyValue, icon: ICON.copy, run: () => copy(x.value, m.copied) },
      'sep',
      { label: m.forget + '…', icon: ICON.delete, iconClass: 'danger', run: forget }
    ])
  return html`
    <div key=${x.key} class="mem">
      <div class="mem-head">
        <span class="mem-key num">${x.key}</span>
        <button class="ib" type="button" data-k=${`mem:${x.key}`} aria-label=${m.more} aria-haspopup="menu" onClick=${menu} dangerouslySetInnerHTML=${{ __html: ICON.more }} />
      </div>
      ${markdown(x.value, openLink)}
    </div>
  `
}
