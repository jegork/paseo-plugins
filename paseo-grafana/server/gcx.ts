import { run } from "./exec";
import { createLimiter } from "./limit";

const limit = createLimiter(3);

// gcx switches to agent mode (and spills big responses to temp files) when it sees an agent env var
const PLAIN_ENV = {
  CLAUDECODE: "",
  CLAUDE_CODE: "",
  CURSOR_AGENT: "",
  GITHUB_COPILOT: "",
  AMAZON_Q: "",
  OPENCODE: "",
  PI_CODING_AGENT: "",
  GCX_AGENT_MODE: "",
};

export async function gcx<T>(args: string[]): Promise<T> {
  let stdout: string;
  try {
    stdout = await limit(() => run("gcx", [...args, "-o", "json", "--no-color"], { env: PLAIN_ENV }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/login|unauthori[sz]ed|401|invalid.*token/i.test(message)) {
      throw new Error("gcx is not signed in for the current context. Run `gcx login` and try again.");
    }
    throw new Error(message.split("\n")[0] ?? message);
  }
  return JSON.parse(stdout) as T;
}

interface GcxContext {
  current: boolean;
  name: string;
  server?: string;
}

let cachedContext: { name: string; server: string; at: number } | null = null;

export async function currentContext(): Promise<{ name: string; server: string }> {
  if (cachedContext && Date.now() - cachedContext.at < 5 * 60_000) return cachedContext;
  const { contexts } = await gcx<{ contexts: GcxContext[] }>(["config", "list-contexts"]);
  const current = contexts.find((context) => context.current);
  if (!current?.server) throw new Error("gcx has no current context with a server. Run `gcx login` first.");
  cachedContext = { name: current.name, server: current.server.replace(/\/$/, ""), at: Date.now() };
  return cachedContext;
}
