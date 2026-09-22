# paseo-ado

Azure DevOps support for Paseo, built on the `az` CLI (`azure-devops` extension). No credentials are stored by the plugin; `az login` on the daemon machine is the only setup.

## Install

```sh
paseo plugin add jegork/paseo-ado
```

Requires the `az` CLI with the `azure-devops` extension, logged in on the daemon machine (`az login`).

## What it adds

- **ADO PR panel** (workspace tab, also in Explorer): the active pull request for the current branch, reviewer votes, pipeline runs on `refs/pull/<id>/merge`, and review comments. Offers a Create button when the branch has no PR.
- **Merge** from the panel: pick a strategy the branch policy allows, delete-source-branch and work-item transition, then either set auto-complete (Azure DevOps merges when every policy passes) or complete now, which is enabled only when the merge has succeeded and all required policies are approved. Never bypasses policies.
- **Send to agent** from the panel: one review comment, all open comments at once, the pipeline status table, or a failed run's error issues plus the tail of each failed task's log (capped at about 12 KB). Goes to the workspace's agent, with a picker when there are several. Sending is one-directional; the plugin never writes to Azure DevOps threads.
- **Attachment sources** in the composer: *Azure DevOps work item* and *Azure DevOps pull request*. Search by id or title fragment; the attached text is a snapshot of the item.
- **Slash commands** (workspace context):
  - `/adopr [title]` pushes the branch if needed and opens a PR with the given title or the last commit subject. The description is left empty on purpose.
  - `/ado-checkout <pr-id>` creates a worktree workspace on the PR's source branch.
- **Command Center**: "Open Azure DevOps pull request".

Repo-scoped calls run inside the workspace directory, so `az` reads org, project and repository from the git remote. Attachment search has no workspace, so it uses `az devops configure` defaults for org and project.

Every `az` call goes through a pool of three, because Azure DevOps throttles per user.

## Develop

```sh
pnpm install
pnpm run typecheck
paseo plugin reload paseo-ado
paseo plugin logs paseo-ado
```
