# paseo-grafana

Grafana alerts and dashboards in Paseo, built on the `gcx` CLI. The plugin uses whatever `gcx` context is current on the daemon machine; `gcx login` is the only setup.

## Install

```sh
paseo plugin add jegork/paseo-grafana
```

Requires the `gcx` CLI, logged in on the daemon machine (`gcx login`).

## What it adds

- **Grafana** sidebar surface: firing and pending alert instances (toggle to all), with links to the rule and its dashboard. *Investigate* picks a workspace and spawns an agent there with the rule's details and instructions to use the `investigate-alert` and `debug-with-grafana` skills through `gcx`.
- **Attachment sources** in the composer: *Grafana dashboard* and *Grafana alert rule*. The attached text carries the title, folder, tags, description and panel list, or the rule's state, labels, annotations and query.
- **Slash command** `/grafana-investigate <rule name or uid>` (workspace context): same investigation agent, in the current workspace.
- **Command Center**: "Open Grafana alerts".

The provider for investigation agents is `INVESTIGATION_PROVIDER` in `shared/grafana.ts`. Change it and reload.

`gcx` calls run outside agent mode with `-o json`, through a pool of three.

## Develop

```sh
pnpm install
pnpm run typecheck
paseo plugin reload paseo-grafana
paseo plugin logs paseo-grafana
```
