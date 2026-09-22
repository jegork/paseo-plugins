import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { MergeStrategy, prComplete, prMergeState } from "../shared/ado";
import { az } from "./az";

interface AzPrForMerge {
  pullRequestId: number;
  status: string;
  isDraft: boolean;
  mergeStatus: string;
  autoCompleteSetBy: { displayName: string } | null;
  lastMergeSourceCommit: { commitId: string } | null;
  completionOptions: {
    mergeStrategy?: MergeStrategy | null;
    deleteSourceBranch?: boolean | null;
    transitionWorkItems?: boolean | null;
    mergeCommitMessage?: string | null;
  } | null;
  repository: { id: string; project: { name: string } };
}

interface AzPolicyEvaluation {
  status: string;
  configuration: {
    isBlocking: boolean;
    type: { displayName: string };
    settings?: {
      allowNoFastForward?: boolean;
      allowSquash?: boolean;
      allowRebase?: boolean;
      allowRebaseMerge?: boolean;
    };
  };
}

const ALL_STRATEGIES: MergeStrategy[] = ["noFastForward", "squash", "rebase", "rebaseMerge"];

function allowedStrategies(policies: AzPolicyEvaluation[]): MergeStrategy[] {
  const policy = policies.find((p) => p.configuration.type.displayName === "Require a merge strategy");
  const settings = policy?.configuration.settings;
  if (!settings) return ALL_STRATEGIES;
  const allowed: MergeStrategy[] = [];
  if (settings.allowNoFastForward) allowed.push("noFastForward");
  if (settings.allowSquash) allowed.push("squash");
  if (settings.allowRebase) allowed.push("rebase");
  if (settings.allowRebaseMerge) allowed.push("rebaseMerge");
  return allowed.length ? allowed : ALL_STRATEGIES;
}

async function load(cwd: string, id: number): Promise<{ pr: AzPrForMerge; policies: AzPolicyEvaluation[] }> {
  const [pr, policies] = await Promise.all([
    az<AzPrForMerge>(["repos", "pr", "show", "--id", String(id)], cwd),
    az<AzPolicyEvaluation[]>(["repos", "pr", "policy", "list", "--id", String(id)], cwd).catch(() => [] as AzPolicyEvaluation[]),
  ]);
  return { pr, policies };
}

export async function mergeState({ cwd, id }: RpcInput<typeof prMergeState>): Promise<RpcOutput<typeof prMergeState>> {
  const { pr, policies } = await load(cwd, id);
  const summary = policies.map((p) => ({ type: p.configuration.type.displayName, status: p.status, blocking: p.configuration.isBlocking }));
  const blockingUnmet = summary.some((p) => p.blocking && p.status !== "approved");
  return {
    mergeStatus: pr.mergeStatus,
    isDraft: pr.isDraft,
    autoCompleteBy: pr.autoCompleteSetBy?.displayName ?? null,
    strategy: pr.completionOptions?.mergeStrategy ?? null,
    deleteSourceBranch: pr.completionOptions?.deleteSourceBranch ?? false,
    allowedStrategies: allowedStrategies(policies),
    policies: summary,
    canCompleteNow: pr.status === "active" && !pr.isDraft && pr.mergeStatus === "succeeded" && !blockingUnmet,
  };
}

// az repos pr update only knows squash as a boolean, so strategy changes go through the rest api
async function patch(cwd: string, pr: AzPrForMerge, body: Record<string, unknown>): Promise<AzPrForMerge> {
  const dir = mkdtempSync(join(tmpdir(), "paseo-ado-"));
  const file = join(dir, "body.json");
  writeFileSync(file, JSON.stringify(body));
  try {
    return await az<AzPrForMerge>(
      ["devops", "invoke", "--area", "git", "--resource", "pullRequests", "--http-method", "PATCH",
        "--route-parameters", `project=${pr.repository.project.name}`, `repositoryId=${pr.repository.id}`, `pullRequestId=${pr.pullRequestId}`,
        "--api-version", "7.1", "--in-file", file],
      cwd,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function complete(input: RpcInput<typeof prComplete>): Promise<RpcOutput<typeof prComplete>> {
  const { cwd, id, action } = input;
  const { pr, policies } = await load(cwd, id);
  if (pr.status !== "active") throw new Error(`Pull request !${id} is ${pr.status}`);
  const finish = (updated: AzPrForMerge) => ({ status: updated.status, autoCompleteBy: updated.autoCompleteSetBy?.displayName ?? null });

  if (action === "cancel-auto-complete") {
    return finish(await az<AzPrForMerge>(["repos", "pr", "update", "--id", String(id), "--auto-complete", "false"], cwd));
  }

  const strategy = input.strategy ?? pr.completionOptions?.mergeStrategy ?? allowedStrategies(policies)[0];
  const completionOptions = {
    mergeStrategy: strategy,
    deleteSourceBranch: input.deleteSourceBranch ?? pr.completionOptions?.deleteSourceBranch ?? true,
    transitionWorkItems: input.transitionWorkItems ?? pr.completionOptions?.transitionWorkItems ?? false,
    mergeCommitMessage: pr.completionOptions?.mergeCommitMessage ?? undefined,
  };

  if (action === "auto-complete") {
    await patch(cwd, pr, { completionOptions });
    return finish(await az<AzPrForMerge>(["repos", "pr", "update", "--id", String(id), "--auto-complete", "true"], cwd));
  }

  if (pr.isDraft) throw new Error("Publish the draft before completing it");
  if (pr.mergeStatus !== "succeeded") throw new Error(`Merge status is ${pr.mergeStatus}; resolve conflicts first`);
  if (!pr.lastMergeSourceCommit) throw new Error("Azure DevOps has not computed a merge for this pull request yet");
  return finish(await patch(cwd, pr, {
    status: "completed",
    lastMergeSourceCommit: { commitId: pr.lastMergeSourceCommit.commitId },
    completionOptions,
  }));
}
