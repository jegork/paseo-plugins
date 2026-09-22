import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PullRequestPanel } from "./client/pr-panel";
import { prCreate, prList, pullRequestSource, workItemSource } from "./shared/ado";

const PANEL_ID = "ado-pull-request";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: PANEL_ID,
    title: "ADO PR",
    icon: "GitPullRequest",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: PullRequestPanel,
  });

  client.addAttachmentSource(workItemSource);
  client.addAttachmentSource(pullRequestSource);

  client.addCommandCenterItem({
    id: "open-pr-panel",
    title: "Open Azure DevOps pull request",
    icon: "GitPullRequest",
    keywords: ["ado", "azure", "pr", "pipeline"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(PANEL_ID);
    },
  });

  client.addSlashCommand({
    name: "adopr",
    description: "Create an Azure DevOps PR from the current branch",
    argumentHint: "[title]",
    context: "workspace",
    async onSubmit({ args, workspace, rpc, openPanel }) {
      await rpc(prCreate, { cwd: workspace.directory, title: args || undefined });
      openPanel(PANEL_ID);
    },
  });

  client.addSlashCommand({
    name: "ado-checkout",
    description: "Check out an Azure DevOps PR in a new worktree workspace",
    argumentHint: "<pr-id>",
    context: "workspace",
    async onSubmit({ args, workspace, paseo, rpc }) {
      const id = Number(args.trim());
      if (!Number.isInteger(id) || id <= 0) throw new Error("Usage: /ado-checkout <pr-id>");
      const { items } = await rpc(prList, { cwd: workspace.directory });
      const pr = items.find((item) => item.id === id);
      if (!pr) throw new Error(`No active pull request !${id} in this repository`);
      await paseo.workspaces.create({
        title: `!${pr.id} ${pr.title}`,
        source: {
          kind: "worktree",
          cwd: workspace.projectRootPath,
          action: "checkout",
          refName: pr.sourceBranch,
        },
      });
    },
  });

  return () => {};
}
