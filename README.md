# Beads for Orca

An [Orca](https://www.onorca.dev) sidebar panel for the [beads](https://github.com/steveyegge/beads) tasks of the focused workspace. English and French, following Orca's language.

## What it shows

- **Current task**: the most recently updated bead in progress.
- **Ready**: what `bd ready` lists, the open beads with no active blocker.
- **Epics**: each epic with its progress and its tasks (grandchildren included), then the beads with no epic.
- **All**: in progress, to do, done. A waiting bead says what it waits on.
- **A bead's details**: description, design, acceptance criteria, notes, parent, blockers, subtasks and comments. Linked beads open on a press.

## What it does

- Start (claim), finish with an optional reason, reopen.
- Change the priority, assign to yourself or to nobody.
- Comment, in markdown.
- Create a task, an epic, or a subtask of an epic.
- **Launch an agent** on a bead. Orca's default agent comes preselected, and any installed, enabled agent can be picked. Run it in this worktree, another worktree of the repository, or a new one. The prompt can be edited first.

The panel reloads when the workspace changes, when an agent changes state, and on refresh.

## Requirements

- Orca 1.4.248 or later.
- `bd` on the PATH Orca sees (`brew install beads`).

## Access it asks for

The plugin runs a worker (`trusted-worker`): a Node process that runs `bd` in the workspace folder. It also asks to read the focused workspace (`workspace:read`), hear agent status changes (`agent:read`) and start agents (`agent:launch`). A new worktree is made with Orca's own CLI (`orca worktree create`), because the plugin API cannot create one. To preselect the agent, the worker reads Orca's agent settings (`defaultTuiAgent`, `disabledTuiAgents`) and looks for agent CLIs on your login shell's PATH.

## Develop

```sh
orca plugin test .       # tests
orca plugin check .      # render every scenario
orca plugin dev load .   # load into Orca (asks for approval)
```

The panel is `src/panel.tsx`, its words are in `src/i18n.ts`, and the worker is `src/worker.ts`.
