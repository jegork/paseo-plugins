# runtime-radar

A Paseo plugin that shows which ports and Docker containers belong to which worktree.

- **Runtime panel** (workspace tab or Explorer): this workspace's listening ports and containers,
  then everything else on the machine with its working directory.
- **Runtime radar** (sidebar): every open workspace with its ports and containers, then projects
  whose main checkout has processes but no open workspace, then anything unattributed.
- ⌘K: "Open runtime panel" in a workspace, "Open runtime radar" anywhere.

Refreshes every five seconds while open. The toolbar and Settings → Plugins → Runtime radar choose
the grouping: by workspace, by project (a project's worktrees folded together), or by kind (all
ports, then all containers, each row naming its scope). The choice is saved per host.

Rows carry Stop and Force kill for processes and Restart and Stop for containers, behind a
confirmation. Turn them off in the settings screen. A process is only signalled if `lsof -a -p`
still shows it listening, and anything named Paseo, the plugin's own process, and its daemon parent
are refused outright.

## Install

```sh
paseo plugin add jegork/paseo-runtime-radar
```

Requires `lsof` on the daemon machine; `docker` is optional and its absence is shown on the panel.

## How attribution works

- Ports come from `lsof -iTCP -sTCP:LISTEN`; each process's working directory is read with a second
  `lsof -d cwd`. A process whose cwd sits inside a workspace directory belongs to that workspace,
  deepest match first, so a worktree beats its project root.
- Containers come from `docker ps`. Compose sets `com.docker.compose.project.working_dir`, which is
  matched the same way. Plain `docker run` containers have no directory and show as unattributed.
- A host port a container publishes is held by Docker's proxy, so those listeners are folded into
  the container row rather than shown twice.
- A process whose cwd is unreadable (another user's) still shows, unattributed.

