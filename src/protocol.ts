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
    labels?: string[]
    /** ISO date the task is due. */
    due_at?: string
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
    created_at: string
    created_by?: string
    owner?: string
    closed_at?: string
    /** Hidden from `bd ready` until then. */
    defer_until?: string
    estimated_minutes?: number
    external_ref?: string
    spec_id?: string
    /** Free key/values set with `bd update --set-metadata`. */
    metadata?: Record<string, unknown>
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
      | 'status'
      | 'assign'
      | 'parent'
      | 'label-add'
      | 'label-remove'
      | 'field'
      | 'link'
      | 'unlink'
      | 'delete'
    reason?: string
    /** The comment to add, in markdown. */
    text?: string
    priority?: number
    /** The other bead: the blocker or related task to add or remove, the canonical one, the replacement, the new parent (empty: none). */
    other?: string
    /** `status`: the new status. `assign`: who. `label-*`: the label. `field`: the value, empty to clear. */
    value?: string
    /** For `field`: which one. */
    field?: 'due' | 'defer' | 'estimate' | 'external-ref' | 'spec-id'
    /** For `edit`: the fields to write; an empty string clears a text field. */
    fields?: { title?: string; type?: string; description?: string; acceptance?: string; design?: string; notes?: string }
  }

  /** What a write answers: ok, or why not. */
  type ActResult = { ok: boolean; problem?: BeadsProblem; error?: string }

  /** A status a workspace adds with `bd config set status.custom`; its category says how it behaves. */
  type CustomStatus = { name: string; category: 'active' | 'wip' | 'done' | 'frozen' }

  /** A worktree of the focused workspace's repository an agent can start in. */
  type LaunchTarget = { id: string; name: string; branch: string | null }
}

declare module 'orca' {
  interface PluginRequests {
    /** Every bead of the focused workspace, the ids `bd ready` lists, or why there are none. */
    'beads.list': {
      /** `me`: who bd writes as, so the panel can show a claim or a comment as yours before bd answers. */
      /** `since`: the version the panel holds; an unchanged list then comes back as `unchanged`, without its beads. */
      /** `closedDays`: how far back closed tasks are loaded, 7 by default, 0 for all of them. */
      /** `fetch`: look at the remote now (seconds on the network) instead of at most every 10 minutes. */
      input: { since?: string; closedDays?: number; fetch?: boolean }
      /** `closedTotal`: every closed task, loaded or not. `epics`: each epic's progress over all its children. */
      output: {
        workspace: string | null
        beads: Bead[]
        ready: string[]
        version?: string
        unchanged?: boolean
        me?: string
        statuses?: CustomStatus[]
        types?: string[]
        /** The git repository the workspace belongs to, shared by its worktrees: what per-project preferences key on. */
        project?: string
        closedDays?: number
        closedTotal?: number
        epics?: Record<string, { done: number; total: number }>
        /** The database has a Dolt remote to sync with. */
        remote?: boolean
        /** It has commits not sent to the remote since the last push or sync this machine knows of. */
        unpushed?: boolean
        /** How many commits those are, when the `dolt` CLI can count them. */
        ahead?: number
        /** How many of the remote's commits it lacks, as of the last look at the remote; unknown until one succeeds. */
        behind?: number
        problem?: BeadsProblem
        error?: string
      }
    }
    /** The focused workspace's folder, without running bd: on a switch, the panel shows what it kept for it at once. */
    'beads.workspace': { output: { workspace: string | null } }
    /** One bead in full. */
    'beads.show': { input: { id: string }; output: { bead: BeadDetail | null; problem?: BeadsProblem; error?: string } }
    /** Claim, close, reopen, reprioritize or (un)assign a bead. */
    'beads.act': { input: BeadAction; output: ActResult }
    /** A new bead, optionally the child of `parent`. */
    'beads.create': {
      input: { title: string; type: string; priority: number; parent?: string; description?: string; labels?: string[]; due?: string; estimate?: number }
      output: ActResult & { id?: string }
    }
    /** Where and with what an agent can start: the repository's worktrees (focused first) and the enabled agents. */
    'beads.targets': {
      output: { current: string | null; workspaces: LaunchTarget[]; agents: { id: string; name: string }[]; defaultAgent: string | null }
    }
    /** The workspace's beads memories (`bd memories`), the facts `bd prime` gives every agent, sorted by key. */
    /** Opens the big view in the middle of Orca: the board editor on the workspace's `.beads-board` file. */
    'beads.board': { output: ActResult }
    /** Pulls the remote's Dolt commits, checks for conflicts, pushes this database's (`bd sync`). */
    'beads.sync': { output: ActResult }
    /** Closed tasks older than the loaded window that match a search, so an old task is still found. */
    'beads.searchClosed': { input: { q: string; before: string }; output: { beads: Bead[]; problem?: BeadsProblem; error?: string } }
    'beads.memories': { output: { memories: { key: string; value: string }[]; problem?: BeadsProblem; error?: string } }
    /** Stores a memory (a new one, or an existing key updated in place) or forgets one. */
    'beads.memory': { input: { action: 'remember' | 'forget'; key?: string; value?: string }; output: ActResult }
    /** Starts `agent` with `prompt` in worktree `target`, or in a new worktree `name` when target is "new". */
    'beads.launch': { input: { agent: string; prompt: string; target: string; name?: string }; output: ActResult & { where?: string } }
  }
}
