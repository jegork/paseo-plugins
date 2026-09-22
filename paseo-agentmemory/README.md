# agentmemory-bridge

A Paseo plugin that feeds omp agents into [agentmemory](https://github.com/rohitg00/agentmemory),
the way agentmemory's own Claude Code and Codex plugins do for those CLIs.

For each captured agent it sends what the hooks send: `session/start` when the agent is created,
`observe` with `prompt_submit` for every user turn and `post_tool_use` for every finished tool call
(input and output split per tool type, output bounded to 8000 characters), and `session/end` after
every turn and on archive. Project names follow the hooks' rule: the git toplevel's basename.

Server-only. Configured from the daemon's environment like the hooks are:

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENTMEMORY_URL` | `http://localhost:3111` | The engine's REST endpoint |
| `AGENTMEMORY_SECRET` | unset | Sent as a bearer token when set |
| `AGENTMEMORY_PROJECT_NAME` | unset | Overrides project resolution |
| `PASEO_AGENTMEMORY_PROVIDERS` | `omp,omp-plugin` | Provider ids to capture |

Claude and Codex are not captured by default because agentmemory's own plugins already hook them;
capturing them here would double every observation.

## Install

```sh
paseo plugin add jegork/paseo-agentmemory
```

Requires Paseo 0.8.

## Recall on creation

Before an agent for a captured provider starts, the bridge searches agentmemory
(`POST /agentmemory/search`) with the agent title, falling back to the directory
name, and appends the best hits as a `## Memory from earlier sessions` section of
the system prompt. Hits below a 0.2 score are dropped, at most five lines of 600
characters each. Nothing is injected when the engine is down or finds nothing.

## Memory rows in the timeline

After each turn the bridge polls `GET /agentmemory/sessions` with backoff (30s up
to 10min) until the engine has consolidated a summary for the agent, then appends
a collapsible `memory-summary` row to the timeline: title, narrative, key
decisions, concepts, and counts. A new consolidation appends a new row.
