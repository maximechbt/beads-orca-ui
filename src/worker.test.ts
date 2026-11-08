// Runs src/worker.ts's activate(orca) with the orca object Orca passes, over a mock host.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'
import { pickDefault } from './agents'

test('answers an error when no workspace is focused', async () => {
  const host = mockHost({ results: { 'workspace.readContext': null } })
  const worker = await mountWorker(main, { host })
  const answer = await worker.request('beads.list')
  assert.equal(answer.workspace, null)
  assert.deepEqual(answer.beads, [])
  assert.equal(answer.problem, 'no-workspace')
  await worker.deactivate()
})

test('turns each action into bd arguments that cannot read as flags', async () => {
  process.env.BEADS_ACTOR = 'Moi'
  const args = (a: Omit<BeadAction, 'id'>) => main.argsFor('.', { id: '-x', ...a } as BeadAction)
  assert.deepEqual(await args({ action: 'claim' }), ['update', '--claim', '--', '-x'])
  assert.deepEqual(await args({ action: 'close', reason: ' fait ' }), ['close', '--reason=fait', '--', '-x'])
  assert.deepEqual(await args({ action: 'close', reason: '  ' }), ['close', '--', '-x'])
  assert.deepEqual(await args({ action: 'reopen' }), ['reopen', '--', '-x'])
  assert.deepEqual(await args({ action: 'priority', priority: 0 }), ['update', '--priority=0', '--', '-x'])
  assert.equal(typeof (await args({ action: 'priority', priority: 7 })), 'string')
  assert.deepEqual(await args({ action: 'assign-me' }), ['update', '--assignee=Moi', '--', '-x'])
  assert.deepEqual(await args({ action: 'unassign' }), ['update', '--assignee=', '--', '-x'])
  assert.deepEqual(await args({ action: 'comment', text: ' -fait ' }), ['comments', 'add', '--', '-x', '-fait'])
  assert.equal(typeof (await args({ action: 'comment', text: '  ' })), 'string')
  assert.equal(typeof (await args({ action: 'rm -rf' } as never)), 'string')
})

const context = { branch: 'main', displayName: 'w', terminals: [] }
const ws = (id: string, name: string) => ({ id, kind: 'worktree', name, path: id.split('::')[1], branch: name, hostId: null })
const list = {
  workspaces: [ws('r::/w', 'w'), ws('r::/w2', 'w2'), ws('other::/o', 'o')].map((w, i) => (i === 0 ? { ...w, branch: 'main' } : w)),
  truncated: false
}

test('offers the focused worktree first, never one Orca cannot tie to its repository', async () => {
  // '/w' is not a real Orca worktree here, so its repository is unknown: only the focused one is offered.
  const host = mockHost({ results: { 'workspace.readContext': context, 'workspace.list': list } })
  const worker = await mountWorker(main, { host })
  const t = await worker.request('beads.targets')
  assert.equal(t.current, 'r::/w')
  assert.deepEqual(t.workspaces.map((w) => w.id), ['r::/w'])
  await worker.deactivate()
})

test('refuses bad input before running anything', async () => {
  const host = mockHost({ results: { 'workspace.readContext': context, 'workspace.list': list } })
  const worker = await mountWorker(main, { host })
  assert.equal((await worker.request('beads.create', { title: ' ', type: 'task', priority: 2 })).ok, false)
  assert.equal((await worker.request('beads.create', { title: 't', type: 'rm', priority: 2 })).ok, false)
  const launch = (input: object) => worker.request('beads.launch', { agent: 'claude', prompt: 'p', target: 'r::/w', ...input })
  assert.equal((await launch({ prompt: ' ' })).ok, false)
  assert.equal((await launch({ agent: 'rm -rf' })).ok, false)
  assert.equal((await launch({ target: 'gone' })).ok, false)
  assert.equal((await launch({ target: 'new', name: '--evil' })).ok, false)
  await worker.deactivate()
})

test('launches the chosen agent in an existing worktree', async () => {
  const host = mockHost({
    results: { 'workspace.readContext': context, 'workspace.list': list, 'agent.launch': { terminalId: 't1' } }
  })
  const worker = await mountWorker(main, { host })
  assert.deepEqual(await worker.request('beads.launch', { agent: 'codex', prompt: 'go', target: 'r::/w2' }), { ok: true, where: 'w2' })
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('picks the agent Orca would: its default when available, else the first available', () => {
  assert.equal(pickDefault(['claude', 'cursor'], { defaultTuiAgent: 'cursor' }), 'cursor')
  assert.equal(pickDefault(['claude', 'codex'], { defaultTuiAgent: 'cursor' }), 'claude') // default not installed
  assert.equal(pickDefault(['claude'], {}), 'claude')
  assert.equal(pickDefault([], { defaultTuiAgent: 'cursor' }), null)
  assert.equal(pickDefault(['claude'], { defaultTuiAgent: 'blank' }), null)
})

test('says what each bead still waits on, forgetting finished blockers', () => {
  const row = (id: string, status: string, deps: [string, string][] = []) => ({
    id, title: id, status, priority: 2, updated_at: '2026',
    dependencies: deps.map(([depends_on_id, type]) => ({ depends_on_id, type }))
  })
  const beads = main.toBeads([
    row('e', 'open'),
    row('done', 'closed'),
    row('doing', 'in_progress'),
    row('t', 'open', [['e', 'parent-child'], ['doing', 'blocks'], ['done', 'blocks']])
  ])
  assert.deepEqual(beads.find((b) => b.id === 't')?.waits_on, ['doing'])
  assert.equal(beads.find((b) => b.id === 'e')?.waits_on, undefined)
  assert.equal('dependencies' in beads[3], false)
})
