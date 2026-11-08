// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'

const bead = (id: string, status: string, updated_at: string, priority = 2): Bead => ({
  id, title: `Task ${id}`, status, priority, updated_at
})
const beads = [
  bead('a', 'open', '2026-01-01', 3),
  bead('b', 'in_progress', '2026-01-02'),
  bead('c', 'in_progress', '2026-01-05'),
  bead('d', 'closed', '2026-01-03'),
  bead('e', 'open', '2026-01-01', 0)
]

test('groups beads: newest in-progress is current', () => {
  const g = panel.group(beads)
  assert.equal(g.current?.id, 'c')
  assert.deepEqual(g.inProgress.map((b) => b.id), ['b'])
  assert.deepEqual(g.todo.map((b) => b.id), ['e', 'a'])
  assert.deepEqual(g.done.map((b) => b.id), ['d'])
  assert.equal(panel.group([]).current, null)
})

test('groups beads under their nearest epic', () => {
  const b = (id: string, extra: Partial<Bead>): Bead => ({ ...bead(id, 'open', '2026'), ...extra })
  const { epics, loose } = panel.byEpic([
    b('E', { issue_type: 'epic' }),
    b('t', { parent: 'E', status: 'closed' }),
    b('t.1', { parent: 't', status: 'in_progress' }), // grandchild: still under E
    b('lone', {}),
    b('x', { parent: 'y' }), // a cycle has no epic, and must not hang
    b('y', { parent: 'x' })
  ])
  assert.equal(epics.length, 1)
  assert.deepEqual(epics[0].children.map((c) => c.id), ['t.1', 't'])
  assert.equal(epics[0].done, 1)
  assert.deepEqual(loose.map((c) => c.id), ['lone', 'x', 'y'])
})

test('lists ready beads, opens one, and goes back', async () => {
  const shown: string[] = []
  const host = mockHost({
    requests: {
      'beads.list': () => ({ workspace: '/w', beads, ready: ['a'] }),
      'beads.show': ({ id }) => {
        shown.push(id)
        return {
          bead: {
            ...bead(id, 'open', '2026-01-01'),
            created_at: '2026-01-01',
            description: 'The **details**',
            comments: [{ id: 'c1', author: 'Ada', text: 'Mind the **PDF**', created_at: '2026-01-02T10:00:00Z' }],
            dependencies: [{ id: 'e', title: 'Task e', status: 'open', dependency_type: 'blocks' }]
          }
        }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ label: 'Refresh' })
  assert.ok(view.find({ label: 'Task c' }), 'current task shown')
  // Ready tab holds only `a`; `e` is open but waits on something.
  assert.ok(view.find({ label: 'Task a' }))
  assert.equal(view.find({ label: 'Task e' }), null)

  await view.press({ label: 'Task a' })
  assert.deepEqual(shown, ['a'])
  assert.ok(view.find({ label: 'Blocked by (1)' }))
  assert.ok(view.find({ label: 'Comments (1)' }))
  // A link opens the linked bead.
  await view.press({ label: 'Task e' })
  assert.deepEqual(shown, ['a', 'e'])

  await view.press({ text: 'All tasks' })
  assert.ok(view.find({ label: 'Task a' }))

  // No epic here: the Epics tab says how to make one.
  await view.select({ label: 'Filter' }, 'epics')
  assert.ok(view.summary().includes('EmptyState "No epics"'), view.summary().join(' | '))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('acts on a bead, creates one, and launches an agent in a new worktree', async () => {
  const calls: { name: string; input: unknown }[] = []
  const record = (name: string, answer: unknown) => (input: unknown) => (calls.push({ name, input }), answer)
  const host = mockHost({
    requests: {
      'beads.list': () => ({ workspace: '/w', beads, ready: ['a'] }),
      'beads.show': ({ id }) => ({ bead: { ...bead(id, 'open', '2026-01-01'), created_at: '2026-01-01' } }),
      'beads.act': record('act', { ok: true }),
      'beads.create': record('create', { ok: true, id: 'new-1' }),
      'beads.targets': () => ({
        current: 'r::/w',
        workspaces: [{ id: 'r::/w', name: 'w', branch: 'main' }],
        agents: [{ id: 'claude', name: 'Claude' }, { id: 'cursor', name: 'Cursor' }],
        defaultAgent: 'cursor'
      }),
      'beads.launch': record('launch', { ok: true, where: 'wt-a' })
    }
  })
  const view = await mount(panel, { host })
  await view.press({ label: 'Refresh' })
  await view.press({ label: 'Task a' })

  await view.press({ text: 'Start' })
  await view.press({ text: 'Finish' })
  await view.type({ label: 'Reason for closing (optional)' }, 'duplicate')
  await view.press({ text: 'Close task' })
  await view.type({ label: 'Add a comment' }, 'Checked with **Ada**')
  await view.press({ text: 'Comment' })
  assert.deepEqual(calls.map((c) => c.input), [
    { id: 'a', action: 'claim' },
    { id: 'a', action: 'close', reason: 'duplicate' },
    { id: 'a', action: 'comment', text: 'Checked with **Ada**' }
  ])
  assert.equal(view.find({ label: 'Add a comment' })?.props.value, '')

  await view.press({ text: 'Launch an agent' })
  // Orca's default agent comes preselected; the person picks another.
  assert.equal(view.find({ label: 'Agent' })?.props.value, 'cursor')
  await view.select({ label: 'Agent' }, 'claude')
  await view.select({ label: 'Where to run it' }, 'new')
  await view.type({ label: 'New worktree name' }, 'wt-a', { replace: true })
  await view.type({ label: 'Prompt' }, ' Quickly.')
  await view.press({ text: 'Create the worktree and launch' })
  assert.deepEqual(calls.at(-1), {
    name: 'launch',
    input: { agent: 'claude', target: 'new', name: 'wt-a', prompt: panel.promptFor({ id: 'a', title: 'Task a' }) + ' Quickly.' }
  })
  assert.ok(view.find({ text: 'Claude is starting in wt-a.' }))

  await view.press({ label: 'New task' })
  await view.type({ label: 'Title' }, 'Write the docs')
  await view.press({ text: 'Create' })
  assert.deepEqual(calls.at(-1), { name: 'create', input: { title: 'Write the docs', type: 'task', priority: 2 } })
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('speaks French when Orca does', async () => {
  const host = mockHost({ requests: { 'beads.list': () => ({ workspace: '/w', beads, ready: ['a'] }) } })
  const view = await mount(panel, { host, locale: 'fr-FR' })
  await view.press({ label: 'Rafraîchir' })
  assert.ok(view.find({ text: 'Tâche courante' }))
  assert.ok(view.summary().some((line) => line.includes('Prêtes (1)')))
  assert.match(panel.promptFor({ id: 'a', title: 'Task a' }), /^Travaille sur la tâche beads a/)
  await view.unmount()
})
