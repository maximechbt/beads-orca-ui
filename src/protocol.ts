// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
export {}

declare global {
  /** One row of `bd list --json`, trimmed to what the panel shows. */
  interface Bead {
    id: string
    title: string
    status: string
    priority: number
    issue_type?: string
    /** The id of the bead this one is a child of. */
    parent?: string
    /** Ids of the unfinished beads this one waits on (its open `blocks` dependencies). */
    waits_on?: string[]
    assignee?: string
    updated_at: string
  }

  /** A bead linked to another one; `dependency_type` is `blocks`, `parent-child`, `related`... */
  interface BeadLink {
    id: string
    title: string
    status: string
    dependency_type: string
  }

  /** `bd show --json` of one bead. */
  interface BeadDetail extends Bead {
    description?: string
    design?: string
    acceptance_criteria?: string
    notes?: string
    labels?: string[]
    created_at: string
    closed_at?: string
    close_reason?: string
    /** What this bead depends on: its parent, its blockers. */
    dependencies?: BeadLink[]
    /** What depends on this bead: its children, what it blocks. */
    dependents?: BeadLink[]
    /** Oldest first, as bd lists them. */
    comments?: BeadComment[]
  }

  interface BeadComment {
    id: string
    author: string
    text: string
    created_at: string
  }

  /** Why the worker has nothing to show; `error` keeps bd's own words for the details. */
  type BeadsProblem = 'no-workspace' | 'no-database' | 'no-bd' | 'not-found' | 'failed'

  /** One change to one bead, run as a bd command by the worker. */
  type BeadAction = {
    id: string
    action:
      | 'claim'
      | 'close'
      | 'reopen'
      | 'priority'
      | 'assign-me'
      | 'unassign'
      | 'comment'
      | 'edit'
      | 'block'
      | 'unblock'
      | 'release'
      | 'duplicate'
      | 'supersede'
    reason?: string
    /** The comment to add, in markdown. */
    text?: string
    priority?: number
    /** The other bead: the blocker to add or remove, the canonical one, the replacement. */
    other?: string
    /** For `edit`: the fields to write; an empty string clears a text field. */
    fields?: { title?: string; type?: string; description?: string; acceptance?: string; design?: string; notes?: string }
  }

  /** What a write answers: ok, or why not. */
  type ActResult = { ok: boolean; problem?: BeadsProblem; error?: string }

  /** A worktree of the focused workspace's repository an agent can start in. */
  type LaunchTarget = { id: string; name: string; branch: string | null }
}

declare module 'orca' {
  interface PluginRequests {
    /** Every bead of the focused workspace, the ids `bd ready` lists, or why there are none. */
    'beads.list': { output: { workspace: string | null; beads: Bead[]; ready: string[]; problem?: BeadsProblem; error?: string } }
    /** One bead in full. */
    'beads.show': { input: { id: string }; output: { bead: BeadDetail | null; problem?: BeadsProblem; error?: string } }
    /** Claim, close, reopen, reprioritize or (un)assign a bead. */
    'beads.act': { input: BeadAction; output: ActResult }
    /** A new bead, optionally the child of `parent`. */
    'beads.create': { input: { title: string; type: string; priority: number; parent?: string; description?: string }; output: ActResult & { id?: string } }
    /** Where and with what an agent can start: the repository's worktrees (focused first) and the enabled agents. */
    'beads.targets': {
      output: { current: string | null; workspaces: LaunchTarget[]; agents: { id: string; name: string }[]; defaultAgent: string | null }
    }
    /** Starts `agent` with `prompt` in worktree `target`, or in a new worktree `name` when target is "new". */
    'beads.launch': { input: { agent: string; prompt: string; target: string; name?: string }; output: ActResult & { where?: string } }
  }
}
