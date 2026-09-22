# codegraph

A Paseo plugin that puts [CodeGraph](https://github.com/colbymchenry/codegraph), the per-project
symbol and call graph behind the `codegraph_explore` agent tool, in front of the human.

- **Attach code graph** (composer attachment menu): search symbols by name across every open
  workspace whose project has a `.codegraph/` index, pick one, and the agent receives the output of
  `codegraph explore <symbol>`: the symbol's source, what calls it, what it calls, and its blast
  radius. The attachment is titled `codegraph: <symbol>`. When no open workspace is indexed the
  picker shows one row explaining how to run `codegraph init`.
- **Impact panel** (workspace tab or Explorer, ⌘K "Open impact panel"): what the workspace's diff
  reaches. Changed files against the merge-base with the default branch plus untracked files, each
  with its indexed symbols; every file and symbol that depends on those symbols within two hops,
  grouped by file and labelled with the changed symbol that reaches it; and the tests that reach
  the change. Rows show `symbol:line`. The panel refreshes on demand, every ten seconds while open,
  and as soon as Paseo reports a different diff stat.

## Install

```sh
paseo plugin add jegork/paseo-codegraph
```

Requires the `codegraph` CLI on the daemon's PATH and a project indexed with `codegraph init`. The
plugin never indexes anything itself.

## How it works

Everything runs on the daemon through the CLI, one `-p <project>` per call:

- `codegraph query <text> --json -l 20` lists symbols for the attachment picker; each distinct name
  then gets one `codegraph explore <name> --max-files 6`, bounded to 24 KB and cached for a minute.
- The panel resolves the workspace directory, then the index root: the nearest ancestor holding
  `.codegraph/`, or for a worktree without one the main checkout, whose index describes the same
  symbols. `git diff --name-only <merge-base>` and `git status --porcelain` give the changed files.
- Each changed file's symbols come from `codegraph node --file <f> --symbols-only`; functions,
  methods and classes (no dunders) get `codegraph impact <symbol> --json -d 2`. `impact` resolves
  by bare name, so a result whose root is not in the changed file is dropped as ambiguous and
  counted as skipped.
- Tests come from the graph walk (dependents in test-looking paths) united with
  `codegraph affected <files> --json`; when that finds nothing it is retried with `**/test_*.py`
  and `**/*_test.*`, because the built-in detection misses pytest naming.
- Bounds: 40 changed files, 12 symbols per file, depth 2, four CLI calls at a time. Reports are
  cached per workspace and reused while the patch and untracked set stay the same; Refresh
  bypasses the cache.

The composer does not tell a plugin which workspace it belongs to, so the attachment search covers
every open workspace's index and names the project in each row when more than one is indexed.

## Develop

```sh
pnpm install
pnpm typecheck
pnpm test
paseo plugin install "$(pwd)"
paseo plugin reload codegraph
```

Parsers and grouping live in `shared/parse.ts` with tests against real CLI output in
`shared/fixtures/`.
