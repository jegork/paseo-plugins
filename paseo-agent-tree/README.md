# agent-tree

A Paseo plugin that puts every agent in one tree, with handoff children nested under
the agent that spawned them, so finding the right tab takes one click instead of several.

## What it shows

**Tree** in the sidebar, and the same screen from the Command Center. Agents are grouped
by project, then by workspace. A child agent hangs under its parent even when it lives in
another worktree, which is where Paseo's own sidebar lists it as a flat sibling. When a
child sits elsewhere, the row underneath names the workspace it actually runs in.

Per agent row: a status dot, the title, a marker when the agent already has a tab open, its
model, and what it is waiting on with the age of that wait, such as `permission · 4m` or
`error · 25m`. An erroring agent shows its last error underneath. A parent row collapses its
subagents and then carries their count.

Workspace headers carry the workspace name, its git branch, its diff stats, and a pin marker.
Project and workspace names come from the daemon's own rows, so a renamed project reads correctly.

Parentage comes from Paseo's `paseo.parent-agent-id` label, and the open-tab marker from
`paseo.open-agent-tab.<client>`. An agent whose parent is archived or missing becomes a root
rather than disappearing.

## Knowing a thread is a child

An agent created by a handoff gets a **Child of `<parent>`** pill in its composer, so the
thread says where it came from without leaving it. Pressing the pill opens the **Lineage**
tab, which lists the chain of parents above the agent and the subagents below it, each one
pressable to jump straight there.

## Filtering and sweeping

The search box matches title, project, workspace, model, and path, and every term has to match.
The chips narrow to attention, running, idle, or closed, each with its own count. Filtering keeps
the ancestors of a match so the branch stays readable; an ancestor kept only as context is dimmed.

A closed agent is one the daemon holds no live session for, not one whose work is done. Reopening
it starts a session and it reads as idle again, so closed agents stay in the All view and have
their own chip for narrowing.

Because of that, the bulk button only offers agents that have been closed for longer than a
chosen age, seven days by default, so a thread that went quiet an hour ago is never swept up.
Every row also has its own archive button. Both need a second press to confirm.

## Settings

Under Settings → Plugins → Tree settings, saved on the host and shared by every client connected
to it: hide closed agents, the bulk archive age, density, diff stats, model, and last error.

## Develop

```bash
pnpm install
pnpm run typecheck
pnpm test
paseo plugin install /absolute/path/to/paseo-agent-tree
paseo plugin reload agent-tree
```

`shared/tree.ts` holds the grouping, nesting, bucketing, ordering, and filtering as pure functions,
and `shared/tree.test.ts` covers the cases that bite: parent cycles, archived parents, cross-workspace
children, closed parents kept as context, pinned workspaces floating above busier ones, and which
agents the bulk sweep is allowed to touch.
