// A small markdown reader for task text and comments. bd's text only ever becomes text children,
// which Preact escapes, so a task's text cannot inject anything into the panel.
import { h } from './vendor/preact.js'
import type { ComponentChildren, VNode } from './vendor/preact.js'

type OnLink = (url: string) => void

/** A ticked box's mark; a constant drawing, not task text. */
const TICK = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 8.3 2.4 2.4 4.6-5"/></svg>'

/** `onLink(url)` opens a link; only http(s) links become links, the rest stay text. */
export function markdown(src: string, onLink: OnLink): VNode {
  return h('div', { class: 'md' }, ...blocks(src, onLink))
}

function blocks(src: string, onLink: OnLink): VNode[] {
  const out: VNode[] = []
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = line.match(/^\s*(```|~~~)/)
    if (fence) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++])
      i++
      out.push(h('pre', null, code.join('\n')))
      continue
    }
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/)
    if (heading) {
      out.push(h('p', { class: 'md-h' }, ...inline(heading[1], onLink)))
      i++
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(h('hr', null))
      i++
      continue
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push(h('blockquote', null, ...blocks(quote.join('\n'), onLink)))
      continue
    }
    const item = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/
    if (item.test(line)) {
      const ordered = Boolean(line.match(item)![1])
      const entries: VNode[] = []
      while (i < lines.length && item.test(lines[i])) {
        let text = lines[i++].match(item)![2]
        // A wrapped item continues on indented lines.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !item.test(lines[i])) text += ' ' + lines[i++].trim()
        const task = text.match(/^\[([ xX])\]\s+(.*)$/)
        entries.push(
          task
            ? h(
                'li',
                { class: 'md-task' },
                h('span', { class: task[1] === ' ' ? 'md-box' : 'md-box on', 'aria-hidden': 'true', dangerouslySetInnerHTML: task[1] === ' ' ? undefined : { __html: TICK } }),
                ...inline(task[2], onLink)
              )
            : h('li', null, ...inline(text, onLink))
        )
      }
      out.push(h(ordered ? 'ol' : 'ul', null, ...entries))
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(lines[i])) para.push(lines[i++].trim())
    out.push(h('p', null, ...inline(para.join(' '), onLink)))
  }
  return out
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|\[([^\]]+)\]\((\S+?)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g

function inline(text: string, onLink: OnLink): ComponentChildren[] {
  const out: ComponentChildren[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    last = m.index! + m[0].length
    if (m[1]) out.push(h('code', null, m[1].slice(1, -1)))
    else if (m[2]) out.push(h('strong', null, ...inline(m[2].slice(2, -2), onLink)))
    else if (m[3]) out.push(h('em', null, ...inline(m[3].slice(1, -1), onLink)))
    else {
      const label = m[4] ?? m[6]
      const url = m[5] ?? m[6]!
      out.push(
        /^https?:\/\//i.test(url)
          ? h('a', { href: url, onClick: (e: Event) => (e.preventDefault(), onLink(url)) }, label)
          : label
      )
    }
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
