// Pieces every view shares: state glyphs, avatars, sections, empty and loading states.
import { categoryOf, isDoing, isDone, initials, hue, own, widerWindow } from '../src/model.ts'
import type { SectionKey } from '../src/model.ts'
import { ICON, PRIORITY, STATUS, TYPE_ICON } from './glyphs.ts'
import { back } from './actions.ts'
import { refresh, showOlderDone } from './data.ts'
import { glyph, html } from './dom.ts'
import type { Child } from './dom.ts'
import { render } from './render.ts'
import { state, t } from './state.ts'
import { copy } from './toast.ts'

/** A name bd keeps made readable: awaiting_review → Awaiting review. */
export const humanize = (s: string) => s.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
/** A status in words: Orca's language for bd's own, the name made readable for a custom one. */
export const statusLabel = (s: string) => own(t().status, s) ?? humanize(s)
/** A type in words, the same way. */
export const typeLabel = (ty = 'task') => own(t().types, ty) ?? humanize(ty)
/** A type's icon; a custom type gets the task's. */
export const typeIcon = (ty = 'task') => own(TYPE_ICON, ty) ?? ICON.task

type StatusKind = keyof typeof STATUS

/** The glyph a task's state gets: waiting tells an open task that cannot start yet. */
export function statusKind(b: { id: string; status: string }, ready: Set<string> | null): StatusKind {
  // Custom statuses take the glyph of their category: a review moves, shipped is done, parked is set aside.
  const category = categoryOf(b.status)
  if (isDone(b)) return 'done'
  if (isDoing(b)) return 'doing'
  if (b.status === 'pinned') return 'pinned'
  if (category === 'frozen') return 'deferred'
  if (b.status === 'blocked' || (ready && category === 'active' && !ready.has(b.id))) return 'waiting'
  return 'open'
}

export const statusGlyph = (b: { id: string; status: string }, ready: Set<string> | null) => {
  const k = statusKind(b, ready)
  return glyph(STATUS[k], `st ${k}`)
}

export const prioGlyph = (p: number) => {
  const i = Math.min(Math.max(p ?? 2, 0), 4)
  const name = t().priorities[i]
  return html`<span class=${`prio p${i}`} title=${name} aria-label=${name} role="img" dangerouslySetInnerHTML=${{ __html: PRIORITY[i] }} />`
}

/** An epic's colour, the same everywhere it shows: dot, icon, progress. */
export const epicColor = (id: string) => `hsl(${hue(id)} 58% 52%)`

export const swatch = (id: string) => html`<span class="swatch" style=${`background:${epicColor(id)}`} aria-hidden="true" />`

/** Each state group's glyph: the list's headers, the board's columns, the filters, the epic counts. */
export const GROUP_MARK = { doing: 'doing', todo: 'open', blocked: 'waiting', done: 'done' } as const
/** A group's glyph: a custom status's group takes its category's. */
const groupMark = (k: SectionKey) => own<StatusKind>(GROUP_MARK, k) ?? statusKind({ id: '', status: k }, null)
export const groupGlyph = (k: SectionKey) => glyph(STATUS[groupMark(k)], `st ${groupMark(k)}`)
export const groupIcon = (k: SectionKey) => ({ icon: STATUS[groupMark(k)], iconClass: `st ${groupMark(k)}` })
export function groupNames(): Record<'doing' | 'todo' | 'blocked' | 'done', string> {
  const m = t()
  return { doing: m.inProgress, todo: m.todo, blocked: m.blocked, done: m.done }
}
/** Any group's name, a custom status's included. */
export const groupName = (k: SectionKey) => own<string>(groupNames(), k) ?? statusLabel(k)

/** "Nov 25", for due dates on rows and cards. */
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString(orca.locale || 'en', { day: 'numeric', month: 'short' })

/** The mark a bug or an epic gets before its title; other types show only in the task. */
export function typeMark(type?: string) {
  if (type !== 'bug' && type !== 'epic') return null
  const label = t().types[type] ?? type
  return html`<span class=${`tm ${type}`} title=${label} role="img" aria-label=${label} dangerouslySetInnerHTML=${{ __html: TYPE_ICON[type] }} />`
}

/** An epic's progress bar, coloured like the epic. */
export function epicBar(epic: Bead, done: number, total: number) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return html`<span class="bar-track" role="progressbar" aria-label=${t().epicProgress(epic.title)} aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100">
    <span class="bar-fill" style=${`display:block;width:${pct}%;background:${epicColor(epic.id)}`} />
  </span>`
}

/** "Show 500 more (736 left)" under a list or a column cut short. */
export const moreButton = (key: string, step: number, rest: number, onMore: () => void) =>
  html`<button key="more" class="more-rows" type="button" data-k=${`more:${key}`} onClick=${onMore}>${t().showMore(Math.min(rest, step), rest)}</button>`

/** The workspace folder's name, beside "Beads". */
export const wsName = () => (state.ws ? (state.ws.split('/').filter(Boolean).pop() ?? '') : '')

export const avatar = (name?: string) =>
  name
    ? html`<span class="avatar" style=${`background:hsl(${hue(name)} 42% 44%)`} title=${name} aria-label=${name} role="img">${initials(name)}</span>`
    : html`<span class="avatar none" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICON.user }} />`

const rtf = () => new Intl.RelativeTimeFormat(orca.locale || 'en', { numeric: 'auto' })

export function ago(at: number) {
  const s = Math.round((at - Date.now()) / 1000)
  if (s > -45) return rtf().format(0, 'second')
  if (s > -3600) return rtf().format(Math.round(s / 60), 'minute')
  if (s > -86400) return rtf().format(Math.round(s / 3600), 'hour')
  return rtf().format(Math.round(s / 86400), 'day')
}

export const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(orca.locale || 'en', { dateStyle: 'medium', timeStyle: 'short' }) : null)

/** A placeholder bar, drawn with the geometry of what replaces it. */
const bar = (width: string, cls = '') => html`<i class=${`sk${cls ? ` ${cls}` : ''}`} style=${`width:${width}`} />`

/** The list as it will arrive: In progress open with a few rows, the other groups folded. */
export function listSkeleton() {
  const group = (w: string) => html`<div class="group-h sk-static">${bar('12px', 'sk-chev')}${bar('14px', 'sk-dot')}${bar(w)}</div>`
  const row = (title: string, meta?: string) => html`
    <div class="row bare sk-static">
      ${bar('14px', 'sk-prio')}${bar('22px')}${bar(title, 'sk-title')}<span />
      ${meta ? html`<span class="meta">${bar(meta)}</span>` : null}
    </div>
  `
  return html`
    <div role="status" aria-label=${t().loadingBeads} aria-busy="true">
      ${group('72px')}${row('64%', '38%')}${row('78%')}${row('52%', '30%')}${group('48px')}${group('56px')}
    </div>
  `
}

/** A task as it will arrive: title, properties, actions, description; the title is real when the list knows it. */
export function detailSkeleton(known?: Bead) {
  const prop = (w: string) => html`<dt>${bar('52px')}</dt><dd><span class="pv">${bar('14px', 'sk-dot')}${bar(w)}</span></dd>`
  return html`
    <div role="status" aria-label=${t().loadingBead(state.ui.openId ?? '')} aria-busy="true">
      ${known ? html`<h1>${known.title}</h1>` : html`<div class="sk-h1">${bar('68%', 'sk-title-lg')}</div>`}
      <dl class="props">${prop('84px')}${prop('56px')}${prop('96px')}${prop('48px')}${prop('120px')}</dl>
      <div class="acts">${bar('84px', 'sk-btn')}${bar('76px', 'sk-btn')}</div>
      <div class="desc sk-lines">${bar('96%')}${bar('88%')}${bar('42%')}</div>
    </div>
  `
}

/** Memories as they will arrive: a key, then a line or two of text. */
export function memorySkeleton() {
  const item = (lines: string[]) => html`<div class="mem sk-lines">${bar('76px')}${lines.map((w) => bar(w))}</div>`
  return html`
    <div role="status" aria-label=${t().memory} aria-busy="true">
      <div class="mem-intro">${bar('62%')}</div>
      <div class="sk-search" />
      ${item(['92%', '54%'])}${item(['70%'])}${item(['88%', '36%'])}
    </div>
  `
}

export function empty(icon: string, title: string, hint?: string | null, ...extra: Child[]) {
  return html`
    <div class="empty">
      ${glyph(icon)}
      <b>${title}</b>
      ${hint ? html`<p>${hint}</p>` : null}
      ${extra}
    </div>
  `
}

const PROBLEMS = () => {
  const m = t()
  return {
    'no-workspace': [ICON.folder, m.noWorkspace, m.noWorkspaceHint],
    'no-database': [ICON.layers, m.noDatabase, m.noDatabaseHint, 'bd init'],
    'no-bd': [ICON.wrench, m.noBd, m.noBdHint, 'brew install beads'],
    'not-found': [ICON.search, m.notFound, m.notFoundHint],
    failed: [ICON.warning, m.failed, m.failedHint]
  }
}

/** A friendly empty state; bd's raw words stay one click away for whoever wants them. */
export function problemState(problem: BeadsProblem, error?: string, id?: string) {
  const m = t()
  const [icon, title, hint, command] = PROBLEMS()[problem] ?? PROBLEMS().failed
  return html`
    <div>
      ${empty(
        icon,
        title,
        id ? `${id} · ${hint}` : hint,
        command
          ? html`<span class="cmd">
              <code>${command}</code>
              <button class="ib" type="button" aria-label=${m.copyId} title=${command} onClick=${() => copy(command)} dangerouslySetInnerHTML=${{ __html: ICON.copy }} />
            </span>`
          : null,
        html`<button class="btn" type="button" onClick=${refresh}>${glyph(ICON.refresh)}${m.retry}</button>`
      )}
      ${error ? html`<details class="raw"><summary>${m.details}</summary><pre>${error}</pre></details>` : null}
    </div>
  `
}

/** The bar on top of a task, the memory and the forms: back, where you are, and what can be done here. */
export function topbar(crumbs: Child, ...right: Child[]) {
  const m = t()
  return html`
    <div class="topbar">
      <button class="ib" type="button" aria-label=${m.back} title=${`${m.back} (esc)`} data-k="back" onClick=${back} dangerouslySetInnerHTML=${{ __html: ICON.back }} />
      <div class="crumbs">${crumbs}</div>
      ${right}
    </div>
  `
}

/** A titled part of a task that folds; it remembers being folded while the task stays open. */
export function section(key: string, title: string, count: number | string | null, defaultOpen: boolean, body: () => Child, end?: Child) {
  const isOpen = state.secs[key] ?? defaultOpen
  const toggle = () => {
    state.secs = { ...state.secs, [key]: !isOpen }
    render()
  }
  return html`
    <section class="sec" key=${key}>
      <button class="sec-h" type="button" data-k=${`s:${key}`} aria-expanded=${String(isOpen)} onClick=${toggle}>
        ${glyph(ICON.chevron, 'chev')}${title}
        ${count !== null && count !== undefined ? html`<span class="num">${count}</span>` : null}
        ${end ? html`<span class="end">${end}</span>` : null}
      </button>
      ${isOpen ? html`<div class="sec-b">${body()}</div>` : null}
    </section>
  `
}

/** Beside "Done": how far back it reaches, with every closed task counted in the tooltip. */
export function doneWindow() {
  const m = t()
  const days = state.ui.closedDays
  return days ? html`<span class="window" title=${m.closedTotal(state.list?.closedTotal ?? 0)}>${m.lastDays(days)}</span>` : null
}

/** Under the done tasks: load the next, wider window of them, until all show. */
export function olderDone() {
  const next = widerWindow(state.ui.closedDays)
  if (next === null) return null
  return html`<button class="more-rows older" type="button" data-k="older-done" onClick=${showOlderDone}>${t().olderDone(next)}</button>`
}
