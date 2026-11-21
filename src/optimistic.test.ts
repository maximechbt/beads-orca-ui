// What a write shows before bd confirms it.
import { assert, test } from 'orca/testing'
import { applyToDetail, applyToList, dateFrom, isTemp, newDetail } from './optimistic.ts'
import type { Context, Write } from './optimistic.ts'

const now = new Date('2026-11-21T10:00:00Z')
const bead = (id: string, status = 'open', extra: Partial<Bead> = {}): Bead => ({ id, title: `Task ${id}`, status, priority: 2, updated_at: '2026-11-01', ...extra })
const list = {
  beads: [bead('a'), bead('b', 'open', { waits_on: ['a'] }), bead('c', 'in_progress', { assignee: 'Ada' }), bead('e', 'open', { issue_type: 'epic' })],
  ready: ['a', 'e']
}
const ctx: Context = { me: 'Moi', now, find: (id) => list.beads.find((b) => b.id === id) }
const act = (action: Omit<BeadAction, 'id'> & { id?: string }): Write => ({ kind: 'act', action: { id: 'a', ...action } as BeadAction })
const one = (l: typeof list, id: string) => l.beads.find((b) => b.id === id)

test('closing a task frees what waited on it, and it leaves Ready', () => {
  const l = applyToList(list, [act({ action: 'close', reason: 'done' })], ctx)
  assert.equal(one(l, 'a')?.status, 'closed')
  assert.equal(one(l, 'b')?.waits_on, undefined)
  assert.deepEqual(l.ready.sort(), ['b', 'e'])
  assert.equal(list.beads[0].status, 'open', "bd's answer is left as it came")
})

test('claiming makes the task yours and moving; releasing gives it back', () => {
  const claimed = applyToList(list, [act({ action: 'claim' })], ctx)
  assert.equal(one(claimed, 'a')?.status, 'in_progress')
  assert.equal(one(claimed, 'a')?.assignee, 'Moi')
  assert.ok(!claimed.ready.includes('a'))
  const released = applyToList(list, [act({ id: 'c', action: 'release' })], ctx)
  assert.equal(one(released, 'c')?.status, 'open')
  assert.equal(one(released, 'c')?.assignee, undefined)
})

test('a new dependency makes the task wait; removing it frees it', () => {
  const l = applyToList(list, [act({ id: 'e', action: 'block', other: 'a' })], ctx)
  assert.deepEqual(one(l, 'e')?.waits_on, ['a'])
  assert.ok(!l.ready.includes('e'))
  const freed = applyToList(list, [act({ id: 'b', action: 'unblock', other: 'a' })], ctx)
  assert.ok(freed.ready.includes('b'))
})

test('writes in flight stack in order, and a delete removes the task', () => {
  const l = applyToList(list, [act({ action: 'priority', priority: 0 }), act({ action: 'label-add', value: 'ui' }), act({ id: 'e', action: 'delete' })], ctx)
  assert.equal(one(l, 'a')?.priority, 0)
  assert.deepEqual(one(l, 'a')?.labels, ['ui'])
  assert.equal(one(l, 'e'), undefined)
  assert.ok(!l.ready.includes('e'))
})

test('a task being created shows at once under a temporary id', () => {
  const w: Write = { kind: 'create', id: '~1', task: { title: ' New ', type: 'bug', priority: 1, labels: ['x'], due: 'tomorrow' } }
  const l = applyToList(list, [w], ctx)
  assert.equal(one(l, '~1')?.title, 'New')
  assert.ok(l.ready.includes('~1'))
  assert.equal(one(l, '~1')?.due_at, '2026-11-22T10:00:00.000Z')
  assert.ok(isTemp('~1') && !isTemp('demo-1'))
  assert.equal(newDetail(w, ctx).issue_type, 'bug')
})

test('the open task shows a comment, an edit and both sides of a link', () => {
  const d: BeadDetail = { ...bead('a'), created_at: '2026-11-01', dependencies: [], dependents: [], comments: [] }
  const shown = applyToDetail(
    d,
    [act({ action: 'comment', text: ' Hello ' }), act({ action: 'edit', fields: { description: 'Why', notes: '' } }), act({ id: 'b', action: 'block', other: 'a' }), act({ action: 'link', other: 'c' })],
    ctx
  )
  assert.equal(shown.comments?.[0].author, 'Moi')
  assert.equal(shown.comments?.[0].text, 'Hello')
  assert.equal(shown.description, 'Why')
  assert.equal(shown.notes, undefined)
  assert.deepEqual(shown.dependents?.map((l) => [l.id, l.dependency_type]), [['b', 'blocks']])
  assert.deepEqual(shown.dependencies?.map((l) => [l.id, l.dependency_type, l.title]), [['c', 'related', 'Task c']])
})

test('reads the dates the panel offers, and leaves the rest to bd', () => {
  assert.equal(dateFrom('today', now), '2026-11-21T10:00:00.000Z')
  assert.equal(dateFrom('+2d', now), '2026-11-23T10:00:00.000Z')
  assert.equal(dateFrom('+1w', now), '2026-11-28T10:00:00.000Z')
  assert.equal(dateFrom('2026-12-01', now), '2026-12-01T00:00:00.000Z')
  assert.equal(dateFrom('next monday', now), null)
})
