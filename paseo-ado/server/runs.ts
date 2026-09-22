import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { runFailure } from "../shared/ado";
import { az } from "./az";
import { buildUrl } from "./pull-requests";

interface TimelineRecord {
  id: string;
  parentId: string | null;
  type: string;
  name: string;
  result: string | null;
  log: { id: number } | null;
  issues?: { type: string; message: string }[];
}

const TAIL_CHARS = 4000;
const TOTAL_CHARS = 12000;

// each line carries an iso timestamp prefix and ##[...] agent markers that only add noise for the model
function cleanLine(line: string): string {
  return line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, "").replace(/##\[(section|group|endgroup|command)\]/g, "");
}

function tail(lines: string[], budget: number): string {
  const out: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = cleanLine(lines[i] ?? "");
    if (size + line.length + 1 > budget) break;
    out.unshift(line);
    size += line.length + 1;
  }
  return out.join("\n").trim();
}

export async function failure({ cwd, runId, project }: RpcInput<typeof runFailure>): Promise<RpcOutput<typeof runFailure>> {
  const run = await az<{ id: number; url: string; definition: { name: string } }>(
    ["pipelines", "runs", "show", "--id", String(runId)],
    cwd,
  );
  const timeline = await az<{ records: TimelineRecord[] }>(
    ["devops", "invoke", "--area", "build", "--resource", "timeline",
      "--route-parameters", `project=${project}`, `buildId=${runId}`, "--api-version", "7.1"],
    cwd,
  );
  const failed = timeline.records.filter((record) => record.result === "failed" && record.log);
  // tasks carry the real output; fall back to jobs only when no task recorded the failure
  const tasks = failed.filter((record) => record.type === "Task");
  const targets = (tasks.length > 0 ? tasks : failed.filter((record) => record.type === "Job")).slice(0, 5);
  const perTask = Math.min(TAIL_CHARS, Math.floor(TOTAL_CHARS / Math.max(targets.length, 1)));
  const results = await Promise.all(
    targets.map(async (record) => {
      const log = await az<{ value: string[] }>(
        ["devops", "invoke", "--area", "build", "--resource", "logs",
          "--route-parameters", `project=${project}`, `buildId=${runId}`, `logId=${String(record.log!.id)}`,
          "--api-version", "7.1"],
        cwd,
      ).catch(() => ({ value: [] as string[] }));
      return {
        name: record.name,
        issues: (record.issues ?? []).filter((issue) => issue.type === "error").map((issue) => issue.message),
        logTail: tail(log.value, perTask),
      };
    }),
  );
  return { pipeline: run.definition.name, url: buildUrl(run.url, project, run.id), tasks: results };
}
