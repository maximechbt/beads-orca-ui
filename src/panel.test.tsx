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
  // Both tasks in progress sit at the top, newest first.
  assert.ok(view.find({ text: 'In progress (2)' }))
  assert.ok(view.find({ label: 'Task b' }) && view.find({ label: 'Task c' }))
  // All is the default tab, To do the only open section: `a` shows, `e` waits in the folded Blocked.
  assert.ok(view.summary().some((l) => l.includes('"All (5)" selected')), view.summary().join(' | '))
  assert.ok(view.find({ label: 'Blocked (1)' }))
  // All's sections already say the state, so rows show the task's type.
  assert.equal(view.find({ label: 'Task a' })?.props.icon, 'file-text')
  assert.ok(view.find({ label: 'Task a' }))
  assert.equal(view.find({ label: 'Task e' }), null)

  await view.press({ label: 'Task a' })
  assert.deepEqual(shown, ['a'])
  assert.ok(view.find({ label: 'Blocked by (1)' }))
  assert.ok(view.find({ label: 'Comments (1)' }))
  // A link opens the linked bead.
  // Sections start folded: open one to follow its link.
  assert.equal(view.find({ label: 'Task e' }), null)
  await view.toggle({ label: 'Blocked by (1)' })
  await view.press({ label: 'Task e' })
  assert.deepEqual(shown, ['a', 'e'])

  await view.press({ label: 'Back' })
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

  await view.press({ text: 'Finish' })
  await view.type({ label: 'Reason for closing (optional)' }, 'duplicate')
  await view.press({ text: 'Close task' })
  await view.toggle({ label: 'Comments' })
  await view.type({ label: 'Add a comment' }, 'Checked with **Ada**')
  await view.press({ text: 'Comment' })
  assert.deepEqual(calls.map((c) => c.input), [
    { id: 'a', action: 'close', reason: 'duplicate' },
    { id: 'a', action: 'comment', text: 'Checked with **Ada**' }
  ])
  assert.equal(view.find({ label: 'Add a comment' })?.props.value, '')

  // Start opens the launch form: starting a task means handing it to an agent.
  await view.press({ text: 'Start' })
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
  assert.ok(view.find({ text: 'En cours (2)' }))
  assert.ok(view.summary().some((line) => line.includes('"Toutes (5)" selected')))
  assert.equal(panel.promptFor({ id: 'a', title: 'Task a' }), 'Lance la tâche a')
  await view.unmount()
})

test('an epic in progress is never the current task', () => {
  const g = panel.group([
    bead('E', 'in_progress', '2026-02-01', 1),
    bead('t', 'in_progress', '2026-01-01')
  ].map((b) => (b.id === 'E' ? { ...b, issue_type: 'epic' } : b)))
  assert.equal(g.current?.id, 't')
  assert.deepEqual(g.inProgress, [])
})

test('task text headings become bold lines, everything else stays', () => {
  assert.equal(panel.flat('## Goal\nShip it\n### Notes ##\n- #1 is a tag'), '**Goal**\nShip it\n**Notes**\n- #1 is a tag')
})

test('creates a task with a description and an epic, starts an agent, and remembers it', async () => {
  const calls: { name: string; input: unknown }[] = []
  const record = (name: string, answer: unknown) => (input: unknown) => (calls.push({ name, input }), answer)
  const epic = { ...bead('E', 'open', '2026-01-01'), issue_type: 'epic' }
  const made: Bead[] = []
  const host = mockHost({
    requests: {
      'beads.list': () => ({ workspace: '/w', beads: [...beads, epic, ...made], ready: ['a', ...made.map((b) => b.id)] }),
      'beads.show': ({ id }) => ({ bead: { ...bead(id, 'open', '2026-01-01'), created_at: '2026-01-01' } }),
      'beads.create': (input: unknown) => {
        made.push(bead('new-1', 'open', '2026-01-09'))
        return record('create', { ok: true, id: 'new-1' })(input)
      },
      'beads.targets': () => ({
        current: 'r::/w',
        workspaces: [{ id: 'r::/w', name: 'w', branch: 'main' }],
        agents: [{ id: 'claude', name: 'Claude' }],
        defaultAgent: 'claude'
      }),
      'beads.launch': record('launch', { ok: true, where: 'w' })
    }
  })
  const view = await mount(panel, { host })
  await view.press({ label: 'Refresh' })
  await view.press({ label: 'New task' })
  await view.type({ label: 'Title' }, 'Add a coupon field')
  await view.type({ label: 'Description' }, 'Shown **under** the total')
  await view.select({ label: 'Epic' }, 'E')
  await view.press({ text: 'Create and start' })
  assert.deepEqual(calls[0], {
    name: 'create',
    input: { title: 'Add a coupon field', type: 'task', priority: 2, parent: 'E', description: 'Shown **under** the total' }
  })

  // Straight into the launch form for the new task.
  assert.equal(view.find({ label: 'Prompt' })?.props.value, panel.promptFor({ id: 'new-1', title: '' }))
  await view.press({ text: 'Launch' })
  assert.equal(calls.at(-1)?.name, 'launch')

  // Back on the task: it says an agent is on its way, and a second Start is no longer the obvious button.
  assert.ok(view.find({ text: 'Start again' }))
  assert.ok(view.find({ text: 'Claude is starting in w.' }))
  // Reopened later, the task still says an agent is on its way until the agent claims it.
  await view.press({ label: 'Back' })
  await view.press({ label: 'Task new-1' })
  assert.ok(view.find({ text: 'Claude was started on this task. It moves to In progress once the agent claims it.' }))
  assert.ok(view.find({ text: 'Start again' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('searches, edits, manages blockers, closes as duplicate and releases', async () => {
  const calls: unknown[] = []
  const host = mockHost({
    requests: {
      'beads.list': () => ({ workspace: '/w', beads, ready: ['a'] }),
      'beads.show': ({ id }) => ({
        bead: {
          ...(beads.find((b) => b.id === id) ?? bead(id, 'open', '2026-01-01')),
          created_at: '2026-01-01',
          description: 'Old text',
          dependencies: id === 'a' ? [{ id: 'e', title: 'Task e', status: 'open', dependency_type: 'blocks' }] : []
        }
      }),
      'beads.act': (input) => (calls.push(input), { ok: true })
    }
  })
  const view = await mount(panel, { host })
  await view.press({ label: 'Refresh' })

  // Search matches title or id; no match offers to create it.
  await view.type({ label: 'Search tasks' }, 'task d')
  assert.ok(view.find({ label: 'Task d' }))
  assert.equal(view.find({ label: 'Task a' }), null)
  await view.type({ label: 'Search tasks' }, 'nothing like this', { replace: true })
  assert.ok(view.find({ text: 'Create “nothing like this”' }))
  await view.type({ label: 'Search tasks' }, 'Task a', { replace: true })
  await view.press({ label: 'Task a' })

  // Edit: the form starts from the task's current text.
  await view.press({ label: 'Edit' })
  assert.equal(view.find({ label: 'Description' })?.props.value, 'Old text')
  await view.type({ label: 'Title' }, 'Task a, renamed', { replace: true })
  await view.press({ text: 'Save' })
  assert.deepEqual(calls.at(-1), {
    id: 'a',
    action: 'edit',
    fields: { title: 'Task a, renamed', type: 'task', description: 'Old text', acceptance: '', design: '', notes: '' }
  })

  // Blockers are managed in their own section: remove one, add another.
  await view.toggle({ label: 'Blocked by (1)' })
  await view.press({ label: 'Remove blocker Task e' })
  assert.deepEqual(calls.at(-1), { id: 'a', action: 'unblock', other: 'e' })
  await view.select({ label: 'Add a blocker…' }, 'b')
  assert.deepEqual(calls.at(-1), { id: 'a', action: 'block', other: 'b' })

  // Finish as a duplicate: Close stays off until the other task is picked.
  await view.press({ text: 'Finish' })
  await view.select({ label: 'How is it closed?' }, 'duplicate')
  assert.equal(view.find({ text: 'Close task' })?.disabled, true)
  await view.select({ label: 'Which task' }, 'c')
  await view.press({ text: 'Close task' })
  assert.deepEqual(calls.at(-1), { id: 'a', action: 'duplicate', other: 'c' })

  // Release a task in progress, after a confirmation.
  await view.press({ label: 'Back' })
  await view.type({ label: 'Search tasks' }, '', { replace: true })
  await view.press({ label: 'Task c' })
  await view.press({ text: 'Release' })
  assert.ok(view.find({ text: 'Take this task back from its holder? It returns to To do and stops being held.' }))
  await view.press({ text: 'Release' })
  assert.deepEqual(calls.at(-1), { id: 'c', action: 'release' })
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})
