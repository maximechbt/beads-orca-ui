// `orca plugin test .` runs this in Node; the panel page is plain DOM, so its logic is tested here.
import { assert, test } from 'orca/testing'
import { messages } from './i18n.ts'
import * as model from './model.ts'

const bead = (id: string, status: string, updated_at: string, priority = 2, extra: Partial<Bead> = {}): Bead => ({
  id, title: `Task ${id}`, status, priority, updated_at, ...extra
})
const beads = [
  bead('a', 'open', '2026-01-01', 3),
  bead('b', 'in_progress', '2026-01-02'),
  bead('c', 'in_progress', '2026-01-05'),
  bead('d', 'closed', '2026-01-03'),
  bead('e', 'open', '2026-01-01', 0)
]

test('groups beads: newest in-progress is current', () => {
  const g = model.group(beads)
  assert.equal(g.current?.id, 'c')
  assert.deepEqual(g.inProgress.map((b: Bead) => b.id), ['b'])
  assert.deepEqual(g.todo.map((b: Bead) => b.id), ['e', 'a'])
  assert.deepEqual(g.done.map((b: Bead) => b.id), ['d'])
  assert.equal(model.group([]).current, null)
})

test('an epic in progress is never the current task', () => {
  const g = model.group([bead('E', 'in_progress', '2026-02-01', 1, { issue_type: 'epic' }), bead('t', 'in_progress', '2026-01-01')])
  assert.equal(g.current?.id, 't')
  assert.deepEqual(g.inProgress, [])
})

test('splits All into moving, startable, waiting and done', () => {
  const list = [...beads, bead('w', 'open', '2026-01-04', 1), bead('x', 'blocked', '2026-01-04'), bead('E', 'in_progress', '2026-01-09', 2, { issue_type: 'epic' })]
  const s = Object.fromEntries(model.sections(list, new Set(['a', 'e'])).map(([k, l]: [string, Bead[]]) => [k, l.map((b) => b.id)]))
  assert.deepEqual(s, { doing: ['E', 'c', 'b'], todo: ['e', 'a'], blocked: ['w', 'x'], done: ['d'] })
})

test('groups beads under their nearest epic', () => {
  const b = (id: string, extra: Partial<Bead>) => bead(id, 'open', '2026', 2, extra)
  const { epics, loose } = model.byEpic([
    b('E', { issue_type: 'epic' }),
    b('t', { parent: 'E', status: 'closed' }),
    b('t.1', { parent: 't', status: 'in_progress' }), // grandchild: still under E
    b('lone', {}),
    b('x', { parent: 'y' }), // a cycle has no epic, and must not hang
    b('y', { parent: 'x' })
  ])
  assert.equal(epics.length, 1)
  assert.deepEqual(epics[0].children.map((c: Bead) => c.id), ['t.1', 't'])
  assert.equal(epics[0].done, 1)
  assert.deepEqual(loose.map((c: Bead) => c.id), ['lone', 'x', 'y'])
})

test('searches by every word of title or id', () => {
  const b = bead('demo-ck.2', 'open', '2026', 2, { title: 'Build the payment form' })
  assert.ok(model.matches(b, 'payment FORM'))
  assert.ok(model.matches(b, 'ck.2'))
  assert.ok(!model.matches(b, 'payment receipt'))
})

test('rows drop the id prefix every bead shares, never mid-word', () => {
  assert.equal(model.commonPrefix(['demo-ck.1', 'demo-ck.2', 'demo-sr']), 'demo-')
  assert.equal(model.commonPrefix(['demo-ck.1', 'demo-cl.1']), 'demo-')
  assert.equal(model.commonPrefix(['a-1', 'b-2']), '')
  assert.equal(model.commonPrefix(['only-one']), '')
})

test('initials and hues are stable', () => {
  assert.equal(model.initials('Ada Lovelace'), 'AL')
  assert.equal(model.initials('claude'), 'CL')
  assert.equal(model.initials('  '), '?')
  assert.equal(model.hue('demo-ck'), model.hue('demo-ck'))
  assert.ok(model.hue('demo-ck') >= 0 && model.hue('demo-ck') < 360)
})

test('task text headings become bold lines, everything else stays', () => {
  assert.equal(model.flat('## Goal\nShip it\n### Notes ##\n- #1 is a tag'), '**Goal**\nShip it\n**Notes**\n- #1 is a tag')
})

test('speaks French when Orca does, English otherwise', () => {
  assert.equal(messages('fr-FR').promptFor('a'), 'Lance la tâche a')
  assert.equal(messages('en-US').promptFor('a'), 'Start task a')
  assert.equal(messages('de').all, 'All')
  const en = messages('en') as Record<string, unknown>
  const fr = messages('fr') as Record<string, unknown>
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort())
})

test('reads and writes estimates in minutes', () => {
  assert.equal(model.parseMinutes('90'), 90)
  assert.equal(model.parseMinutes('1h30'), 90)
  assert.equal(model.parseMinutes('2 h'), 120)
  assert.equal(model.parseMinutes('1d'), 480)
  assert.equal(model.parseMinutes('soon'), null)
  assert.equal(model.parseMinutes('0'), null)
  assert.equal(model.minutes(90), '1 h 30')
  assert.equal(model.minutes(480), '8 h')
  assert.equal(model.minutes(45), '45 min')
})
