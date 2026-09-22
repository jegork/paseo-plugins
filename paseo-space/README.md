# space

A Paseo plugin that shows every checkout on the machine and how much disk it uses, so worktrees and their caches can be cleaned up from inside Paseo.

## What it shows

- **Space** in the sidebar: every project, biggest first, with one row per checkout: the main checkout, each Paseo worktree workspace, git worktrees Paseo does not track (`not in Paseo`), and git entries whose directory is already gone (`directory gone`).
- **Space** panel in a workspace and in the Explorer: the current workspace first, then the rest of the machine.
- Per row: branch, uncommitted changes, last activity, total size, and the part sitting in regenerable caches (`node_modules`, `.venv`, `.next`, `target`, `__pycache__`, and similar). The bar under each row is its share of the largest checkout; the warning-coloured part is caches.
- Header: total across all worktrees, total in caches, untracked worktrees, and free space on the volume holding `~/.paseo`.

## Actions

Each row menu offers what applies, always behind a confirmation:

| Action | Applies to | What runs |
| --- | --- | --- |
| Clear caches | any checkout with gitignored cache dirs | `rm -rf` on those directories only |
| Archive | Paseo worktree workspaces | `paseo.workspaces.archive`; Paseo removes the worktree |
| Remove worktree / Force remove | git worktrees Paseo does not track | `git worktree remove [--force]` |
| Prune | entries whose directory is gone | `git worktree prune` |

Only gitignored cache directories are offered, so a committed `target/` or `node_modules/` is never deleted. A cache path is deleted only if it sits inside the checkout, has a cache basename, and is a real directory rather than a symlink.

## How sizes are measured

The daemon runs `du -k -d 4` per checkout, four at a time, and caches the result for five minutes. The list refreshes every minute using cached sizes; **Rescan** walks the disk again. Sizing 20 GB of worktrees takes about 10 to 20 seconds on APFS.

## Develop

```bash
pnpm install
pnpm run typecheck
pnpm test
paseo plugin install /absolute/path/to/paseo-space
paseo plugin reload space
paseo plugin logs space
```

`server/space.server.test.ts` builds a real git repository with worktrees in a temp directory and exercises sizing, classification, and every destructive action against it.
