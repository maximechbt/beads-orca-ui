// Building the page with Preact and htm: components written as tagged templates, with no build step.
// Text from bd only goes in as children or attribute values, which Preact escapes; the only markup
// put in raw is glyphs.ts's constant SVGs.
import { Component, html } from './vendor/preact.js'
import type { ComponentChildren } from './vendor/preact.js'

export { html }
export type Child = ComponentChildren

export const searchBox = () => document.getElementById('q') as HTMLInputElement

/** One of glyphs.ts's constant SVGs, never text from bd. */
export const glyph = (svg: string, cls?: string) => html`<span class=${cls} aria-hidden="true" dangerouslySetInnerHTML=${{ __html: svg }} />`

/** The value of the field an input event came from. */
export const valueOf = (e: Event) => (e.currentTarget as HTMLInputElement).value

/** The element a handler sits on, for menus that open under it. */
export const anchorOf = (e: Event) => e.currentTarget as HTMLElement

/** A component that redraws only when one of its props changed, like React's memo. */
export function memo<P extends object>(draw: (props: P) => Child) {
  return class Memo extends Component<P> {
    shouldComponentUpdate(next: P) {
      const before = this.props as Record<string, unknown>
      const after = next as Record<string, unknown>
      for (const k in after) if (before[k] !== after[k]) return true
      for (const k in before) if (!(k in after)) return true
      return false
    }
    render() {
      return draw(this.props)
    }
  }
}
