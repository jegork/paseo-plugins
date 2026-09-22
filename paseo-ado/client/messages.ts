import type { PipelineRun, ReviewComment } from "../shared/ado";

function formatComment(comment: ReviewComment): string {
  const where = comment.file ? `File: ${comment.file}` : "General comment";
  return `${where}\nFrom: ${comment.author} (${comment.date.slice(0, 10)})\n\n${comment.content.trim()}`;
}

export function commentMessage(prId: number, comment: ReviewComment): string {
  return `Address this review comment on pull request !${prId}. Make the code change and report what you did; do not reply on the PR itself.\n\n${formatComment(comment)}`;
}

export function allCommentsMessage(prId: number, comments: ReviewComment[]): string {
  const blocks = comments.map((comment, index) => `--- ${index + 1}/${comments.length} ---\n${formatComment(comment)}`);
  return `Address the open review comments on pull request !${prId}. Work through each one, make the code changes, and report per comment what you did or why no change is needed; do not reply on the PR itself.\n\n${blocks.join("\n\n")}`;
}

export function statusMessage(prId: number, runs: PipelineRun[]): string {
  const rows = runs.map((run) => `- ${run.pipeline}: ${run.result ?? run.status}${run.finished ? ` (finished ${run.finished.slice(0, 16).replace("T", " ")})` : ""}${run.url ? `\n  ${run.url}` : ""}`);
  return `Current pipeline status for pull request !${prId}:\n\n${rows.join("\n")}`;
}

export function failureMessage(
  prId: number,
  failure: { pipeline: string; url: string; tasks: { name: string; issues: string[]; logTail: string }[] },
): string {
  const sections = failure.tasks.map((task) => {
    const issues = task.issues.length ? `Errors:\n${task.issues.map((issue) => `- ${issue}`).join("\n")}\n\n` : "";
    return `## ${task.name}\n${issues}Log tail:\n\`\`\`\n${task.logTail}\n\`\`\``;
  });
  return `The pipeline "${failure.pipeline}" failed on pull request !${prId} (${failure.url}). Find the cause in the log below, fix it, and verify locally where possible.\n\n${sections.join("\n\n")}`;
}
