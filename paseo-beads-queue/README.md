# paseo-beads-queue

A work queue for Paseo agents on top of [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`). Issues live in Beads; the plugin dispatches ready issues to agents, injects `br` into every agent's environment, and writes the outcome back.

## Storage per project

Each project chooses where its queue lives, from the Beads panel or the settings screen:

- **External** (default): `~/.paseo/beads/<project>/.beads`. Nothing is added to the repository. Agents in that project, worktrees included, get `BEADS_DIR` injected on every session open so plain `br` commands work.
- **In repo**: a committed `.beads` directory in the project root, discovered by `br` the normal way. Run `br init` there first.

## What it does

- **Beads panel** (workspace tab, also in Explorer): Ready, In progress, Blocked and Recently closed lanes. Dispatch a ready issue to an agent, open the working agent, create issues, close, block or reopen them.
- **Dispatcher**: with auto-dispatch on for a project, polls `br ready` and dispatches the highest-priority issues up to the project's concurrency cap. Dispatch claims the issue with `br update --claim`, creates a worktree workspace whose branch Paseo names from the issue through its metadata generation, honouring the repo's `paseo.json` `metadataGeneration.branchName` instructions (or opens the project directory), starts an agent with the issue as prompt, comments the agent id on the issue, and appends a row to the agent's timeline.
- **Close the loop**: when a dispatched agent's turn ends, the issue is checked. Closed by the agent means done. Still open means a comment with the agent's last output and a "review" note on the timeline. A failed turn returns the issue to ready. A canceled turn leaves it in progress.
- **Permissions**: `br` commands from dispatched agents are auto-allowed and `git push` is denied; everything else follows the agent's normal mode. The branch name is recorded on the issue when the turn ends.
- **Attachment source** `Beads issue` and slash command `/beads <title>` for quick capture. Command Center: "Open Beads queue".

Agents are told to comment and `br close` when done, `br update --status blocked` when stuck, and `br create` for unrelated findings.

## Config

`~/.paseo/beads/queue.json` holds the dispatcher settings and per-project entries; `queue-state.json` tracks active dispatches. Both are managed from the settings screen. The dispatcher poll loop starts on the first plugin RPC or agent event after the daemon starts.

## Develop

```sh
pnpm install
pnpm run typecheck
paseo plugin reload paseo-beads-queue
paseo plugin logs paseo-beads-queue
```
