// `orca plugin check` renders the panel once per scenario, each with the worker on a fresh host.
import { defineCheck } from 'orca/testing'

const bead = (id: string, title: string, status: string, priority = 2, assignee?: string) => ({
  id,
  title,
  status,
  priority,
  issue_type: id.includes('.') || id === 'demo-9k2' ? 'task' : 'epic',
  ...(assignee ? { assignee } : {}),
  ...(id.includes('.') ? { parent: id.split('.')[0] } : {}),
  updated_at: `2026-11-0${(id.length % 9) + 1}T10:00:00Z`
})
const beads = [
  bead('demo-73t', 'Checkout flow', 'in_progress', 2, 'Ada Lovelace'),
  bead('demo-73t.1', 'Record a payment and issue the receipt', 'open'),
  bead('demo-73t.2', 'Cancel a payment and its receipt', 'open'),
  bead('demo-73t.3', 'Show receipts in the customer area', 'open', 1),
  bead('demo-73t.4', 'Email receipts once the customer agrees', 'open'),
  bead('demo-73t.5', 'Align the docs with the new checkout', 'open', 3),
  bead('demo-73t.6', 'Checkout mockups', 'closed'),
  bead('demo-4fe', 'Payment reminders', 'open', 1),
  bead('demo-4fe.1', 'Reminder schedule', 'closed'),
  bead('demo-4fe.2', 'Reminder email templates', 'open'),
  bead('demo-9k2', 'Fix rounding on fees', 'open', 0)
]
const list = { workspace: '/w', beads, ready: ['demo-73t.1', 'demo-73t.3', 'demo-73t.5', 'demo-4fe.2', 'demo-9k2'] }

export default defineCheck({
  loaded: { requests: { 'beads.list': () => list } },
  nothingReady: { requests: { 'beads.list': () => ({ ...list, ready: [] }) } },
  noBeads: {
    requests: {
      'beads.list': () => ({
        workspace: '/w',
        beads: [],
        ready: [],
        problem: 'no-database',
        error:
          "Error: no beads database found\nHint: run 'bd where' to inspect the resolved workspace, or 'bd init' to create a new database"
      })
    }
  },
  noWorkspace: { requests: { 'beads.list': () => ({ workspace: null, beads: [], ready: [], problem: 'no-workspace' }) } },
  bdFailed: {
    requests: {
      'beads.list': () => ({ workspace: '/w', beads: [], ready: [], problem: 'failed', error: 'Error: database is locked' })
    }
  },
  detail: {
    requests: {
      'beads.list': () => list,
      'beads.show': () => ({
        bead: {
          ...beads[2],
          created_at: '2026-11-02T09:12:00Z',
          labels: ['payments'],
          description:
            'When a payment is **cancelled**, its receipt must be cancelled too.\n\n- keep a trace of the cancellation\n- never delete the PDF',
          acceptance_criteria: '- The receipt shows as *cancelled*\n- The customer no longer sees it',
          dependencies: [
            { id: 'demo-73t', title: 'Checkout flow', status: 'in_progress', dependency_type: 'parent-child' },
            { id: 'demo-73t.1', title: 'Record a payment and issue the receipt', status: 'open', dependency_type: 'blocks' }
          ],
          dependents: [
            { id: 'demo-73t.3', title: 'Show receipts in the customer area', status: 'open', dependency_type: 'blocks' }
          ]
        }
      })
    }
  }
})
