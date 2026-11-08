# Beads for Orca

## Product

An Orca sidebar panel for the beads tasks (`bd`) of the focused workspace. It shows what is in progress, what is ready, epics and their progress, and lets the person act on a task without leaving Orca: start, finish, reopen, reprioritize, assign, comment, create, and launch a coding agent on it.

## Users and jobs

One developer working in Orca with coding agents. They open the panel for all of these, often in the same session:

- choose the next task, then start it themselves or launch an agent on it;
- follow what agents are doing and what moves;
- triage: create, prioritize, attach to epics, comment;
- read a task's description and acceptance criteria while coding.

## Known pain (Nov 2026)

- A task's detail is a long column: actions, priority and comments sit far down.
- Lists are hard to scan: ids, "P2" and status glyphs look alike.
- Too many clicks: starting, finishing or launching an agent means opening the task, then a form.
- No search to find a task by name.

## Constraints

- Platform: an Orca components panel (`ui: components`). Orca draws every component; no CSS, fonts or colors beyond its tones. Narrow right sidebar (~300–400 px).
- English and French, following Orca's language.
- Data comes only from `bd` through the plugin worker. beads has no "cancelled" status: closed is closed.
- Nothing in the current layout is sacred; every current function must remain.
