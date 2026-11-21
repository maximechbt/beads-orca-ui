// A task's properties: each one a menu that writes to bd, and the fields set by typing.
import { allTypes, STATUSES, customStatuses, isDone, byPriority, isDoing, minutes, parseMinutes, stateOf } from '../../src/model.ts'
import { ICON, PRIORITY, STATUS, TYPE_ICON } from '../glyphs.ts'
import { startRelease } from '../actions.ts'
import { act, beads, shortId } from '../data.ts'
import { anchorOf, glyph, html } from '../dom.ts'
import type { Child } from '../dom.ts'
import { isOpen, openMenu } from '../menu.ts'
import type { MenuItem, MenuOpts } from '../menu.ts'
import { state, t } from '../state.ts'
import { copy, openLink } from '../toast.ts'
import { avatar, humanize, prioGlyph, statusKind, statusLabel, swatch, typeLabel } from '../ui.ts'
import { finishMenu, startMenu } from './detail.ts'

export type Field = 'due' | 'defer' | 'estimate' | 'external-ref' | 'spec-id'

/** A property value that opens its menu. */
export function pv(k: string, items: MenuItem[] | ((anchor: HTMLElement) => MenuItem[]), opts: MenuOpts, ...content: Child[]) {
  const onClick = (e: Event) => openMenu(anchorOf(e), typeof items === 'function' ? items(anchorOf(e)) : items, opts)
  return html`
    <button class="pv" type="button" data-k=${k} aria-haspopup="menu" aria-expanded=${String(isOpen(k))} disabled=${state.busy} onClick=${onClick}>
      ${content}${glyph(ICON.down, 'down')}
    </button>
  `
}

const prop = (label: string, value: Child) => html`<dt>${label}</dt><dd>${value}</dd>`

const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(orca.locale || 'en', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

export function properties(b: BeadDetail, epic: Bead | null, ready: Set<string>) {
  const m = t()
  const kind = statusKind(b, ready)
  const closed = b.status === 'closed'
  const doing = isDoing(b)
  // Every status bd lets a person set, then the flows that need more than a word: start, finish, release.
  const statusItems = (anchor: HTMLElement): MenuItem[] =>
    closed
      ? [{ label: m.reopen, icon: ICON.refresh, run: () => act({ id: b.id, action: 'reopen' }, m.reopened) }]
      : ([
          // bd's own statuses, then the ones this workspace adds.
          ...[...STATUSES, ...customStatuses()].map((s) => {
            const k = statusKind({ id: b.id, status: s }, null)
            // In progress by hand is a claim: it also makes the task yours, as `bd update --claim` does.
            const action: BeadAction = s === 'in_progress' ? { id: b.id, action: 'claim' } : { id: b.id, action: 'status', value: s }
            return { label: statusLabel(s), icon: STATUS[k], iconClass: `st ${k}`, check: b.status === s, run: () => b.status !== s && act(action, m.statusChanged) }
          }),
          'sep',
          !doing ? { label: m.start + '…', icon: ICON.play, run: () => startMenu(anchor, b) } : null,
          { label: m.finish + '…', icon: ICON.check, run: () => finishMenu(anchor, b) },
          doing ? { label: m.release + '…', icon: ICON.back, run: () => startRelease(b.id) } : null
        ] as (MenuItem | null)[]).filter((x) => x !== null)
  const parent = b.dependencies?.find((l) => l.dependency_type === 'parent-child')
  const people = [...new Set(beads().map((o) => o.assignee).filter((x): x is string => Boolean(x)))].filter((p) => p !== b.assignee).sort()
  const overdue = !closed && b.due_at && Date.parse(b.due_at) < Date.now()
  const priorities = m.priorities.map((label, i) => ({
    label,
    icon: PRIORITY[i],
    iconClass: `prio p${i}`,
    check: b.priority === i,
    run: () => b.priority !== i && act({ id: b.id, action: 'priority', priority: i }, m.priorityChanged)
  }))
  const assignees = ([
    b.assignee ? null : { label: m.assignMe, icon: ICON.user, run: () => act({ id: b.id, action: 'assign-me' }, m.assigned) },
    ...people.map((p) => ({ label: p, run: () => act({ id: b.id, action: 'assign', value: p }, m.assigned) })),
    b.assignee ? { label: m.unassign, icon: ICON.close, run: () => act({ id: b.id, action: 'unassign' }, m.unassignedDone) } : null
  ] as (MenuItem | null)[]).filter((x) => x !== null)
  const types = allTypes().map((ty) => ({
    label: typeLabel(ty),
    icon: TYPE_ICON[ty] ?? ICON.task,
    check: (b.issue_type ?? 'task') === ty,
    run: () => act({ id: b.id, action: 'edit', fields: { type: ty } }, m.saved)
  }))
  const parents: MenuItem[] = [
    ...beads()
      .filter((o) => o.id !== b.id && !isDone(o))
      .sort((x, y) => Number(y.issue_type === 'epic') - Number(x.issue_type === 'epic') || byPriority(x, y))
      .map((o) => ({ label: o.title, hint: shortId(o.id), icon: o.issue_type === 'epic' ? ICON.epic : undefined, check: parent?.id === o.id, run: () => act({ id: b.id, action: 'parent', other: o.id }, m.saved) })),
    ...(parent ? (['sep', { label: m.noParent, icon: ICON.close, run: () => act({ id: b.id, action: 'parent', other: '' }, m.saved) }] as MenuItem[]) : [])
  ]
  const field = (k: string, f: Field, label: string, value: Child) => prop(label, pv(k, fieldItems(b, f), fieldOpts(b, f), value))
  return html`
    <dl class="props">
      ${prop(
        m.status_,
        pv('p:status', statusItems, {}, glyph(STATUS[kind], `st ${kind}`), html`<span class="t">${kind === 'waiting' && b.status === 'open' ? `${statusLabel(b.status)} · ${m.waiting}` : statusLabel(b.status)}</span>`)
      )}
      ${prop(m.priority, pv('p:prio', priorities, {}, prioGlyph(b.priority), html`<span class="t">${m.priorities[b.priority]?.replace(/^P\d · /, '') ?? `P${b.priority}`}</span>`))}
      ${prop(
        m.assignee,
        pv(
          'p:who',
          assignees,
          { placeholder: m.assignTo, create: (q) => ({ label: m.assignNamed(q), icon: ICON.user, run: () => act({ id: b.id, action: 'assign', value: q }, m.assigned) }) },
          avatar(b.assignee),
          html`<span class=${`t${b.assignee ? '' : ' muted'}`}>${b.assignee ?? m.nobody}</span>`
        )
      )}
      ${prop(m.type, pv('p:type', types, {}, glyph(TYPE_ICON[b.issue_type ?? 'task'] ?? ICON.task, 'muted'), html`<span class="t">${typeLabel(b.issue_type)}</span>`))}
      ${prop(
        m.parent,
        pv('p:parent', parents, { search: true }, parent ? swatch((epic ?? parent).id) : null, html`<span class=${`t${parent ? '' : ' muted'}`}>${parent?.title ?? m.noParentShort}</span>`)
      )}
      ${states(b).map(([dim, value]) => prop(humanize(dim), html`<span class="pv"><span class="t">${value}</span></span>`))}
      ${prop(m.labels, labels(b))}
      ${b.due_at ? field('p:due', 'due', m.due, html`<span class=${`t${overdue ? ' late' : ''}`}>${date(b.due_at)}</span>`) : null}
      ${b.defer_until ? field('p:defer', 'defer', m.deferUntil, html`<span class="t">${date(b.defer_until)}</span>`) : null}
      ${b.estimated_minutes ? field('p:estimate', 'estimate', m.estimate, html`<span class="t num">${minutes(b.estimated_minutes)}</span>`) : null}
      ${b.external_ref ? field('p:external', 'external-ref', m.externalRef, html`<span class="t">${b.external_ref}</span>`) : null}
      ${b.spec_id ? field('p:spec', 'spec-id', m.spec, html`<span class="t">${b.spec_id}</span>`) : null}
    </dl>
  `
}

/** The task's states (`bd set-state`): health:failing reads Health: failing, as a property rather than a label. */
const states = (b: Bead) => (b.labels ?? []).map(stateOf).filter((s) => s !== null)
const plainLabels = (b: Bead) => (b.labels ?? []).filter((l) => !stateOf(l))

/** The labels as chips with a ×, then a + that picks an existing label or makes one. */
function labels(b: BeadDetail) {
  const m = t()
  const own = plainLabels(b)
  return html`
    <span class="pv labels">
      ${own.map(
        (l) => html`<span key=${l} class="chip">
          <span class="t">${l}</span>
          <button class="x" type="button" aria-label=${m.removeLabel(l)} title=${m.removeLabel(l)} disabled=${state.busy} onClick=${() => act({ id: b.id, action: 'label-remove', value: l }, m.saved)} dangerouslySetInnerHTML=${{ __html: ICON.close }} />
        </span>`
      )}
      <button class="chip add" type="button" data-k="p:labels" aria-label=${m.addLabel} title=${m.addLabel} disabled=${state.busy} onClick=${(e: Event) => labelMenu(anchorOf(e), b)}>
        ${glyph(ICON.add)}${own.length ? null : m.addLabel}
      </button>
    </span>
  `
}

/** The presets and the clear entry of one field; what is typed goes through `fieldOpts`. */
export function fieldItems(b: BeadDetail, field: Field): MenuItem[] {
  const m = t()
  const set = (value: string) => act({ id: b.id, action: 'field', field, value }, m.saved)
  const has = { due: b.due_at, defer: b.defer_until, estimate: b.estimated_minutes, 'external-ref': b.external_ref, 'spec-id': b.spec_id }[field]
  const clear: MenuItem[] = has ? ['sep', { label: m.clear, icon: ICON.close, run: () => set('') }] : []
  if (field === 'due' || field === 'defer')
    return [
      { label: m.today, run: () => set('today') },
      { label: m.tomorrow, run: () => set('tomorrow') },
      { label: m.nextWeek, run: () => set('+1w') },
      { label: m.inTwoWeeks, run: () => set('+2w') },
      ...clear
    ]
  if (field === 'estimate') return [...[30, 60, 120, 240, 480, 960].map((n) => ({ label: minutes(n), run: () => set(String(n)) })), ...clear]
  const ref = field === 'external-ref' ? b.external_ref : b.spec_id
  return ([
    ref ? { label: m.copyValue, icon: ICON.copy, run: () => copy(ref, m.copied) } : null,
    ref && /^https?:\/\//i.test(ref) ? { label: m.openLink, icon: ICON.open, run: () => openLink(ref) } : null,
    ...clear
  ] as (MenuItem | null)[]).filter((x) => x !== null)
}

export function fieldOpts(b: BeadDetail, field: Field): MenuOpts {
  const m = t()
  const set = (value: string) => act({ id: b.id, action: 'field', field, value }, m.saved)
  if (field === 'estimate')
    return {
      placeholder: m.estimateHint,
      create: (q) => {
        const n = parseMinutes(q)
        return n ? { label: m.setTo(minutes(n)), run: () => set(String(n)) } : null
      }
    }
  return { placeholder: field === 'due' || field === 'defer' ? m.dateHint : m.valueHint, create: (q) => ({ label: m.setTo(q), run: () => set(q) }) }
}

function labelMenu(anchor: HTMLElement, b: BeadDetail) {
  const m = t()
  const known = [...new Set(beads().flatMap(plainLabels))].filter((l) => !b.labels?.includes(l)).sort()
  const add = (l: string) => act({ id: b.id, action: 'label-add', value: l }, m.saved)
  openMenu(anchor, known.map((l) => ({ label: l, run: () => add(l) })), {
    placeholder: m.addLabel,
    create: (q) => (q.includes(',') || known.includes(q) || b.labels?.includes(q) ? null : { label: m.createLabel(q), icon: ICON.add, run: () => add(q) })
  })
}
