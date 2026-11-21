// The line that says how the last write went, and the two things a page cannot do alone.
import { ICON } from './glyphs.ts'
import { glyph, html } from './dom.ts'
import { render } from './render.ts'
import { state, t } from './state.ts'
import { useEffect } from './vendor/preact.js'

const dismiss = () => {
  state.outcome = null
  render()
}

/** A success fades after a few seconds; a failure stays until closed, bd's words folded under it. */
export function Toast() {
  const o = state.outcome
  useEffect(() => {
    if (!o || o.problem || !o.notice) return
    const timer = setTimeout(() => state.outcome === o && dismiss(), 3500)
    return () => clearTimeout(timer)
  }, [o])
  if (!o || (!o.problem && !o.notice)) return null
  const m = t()
  if (!o.problem) return html`<div class="toast" role="status">${glyph(ICON.check)}<div class="body">${o.notice}</div></div>`
  const text = o.problem === 'no-workspace' ? m.noWorkspaceShort : /blocked by/i.test(o.error ?? '') ? m.stillBlocked : m.actionFailed
  return html`
    <div class="toast err" role="alert">
      ${glyph(ICON.warning)}
      <div class="body">
        <div>${text}</div>
        ${o.error ? html`<details><summary>${m.details}</summary><pre>${o.error}</pre></details>` : null}
      </div>
      <button class="ib" type="button" aria-label=${m.cancel} onClick=${dismiss} dangerouslySetInnerHTML=${{ __html: ICON.close }} />
    </div>
  `
}

export function copy(textToCopy: string, notice?: string) {
  navigator.clipboard?.writeText(textToCopy).then(
    () => {
      if (!notice) return
      state.outcome = { notice }
      render()
    },
    () => {}
  )
}

export function openLink(url: string) {
  orca.shell?.openExternal(url).catch(() => {})
}
