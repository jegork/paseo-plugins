import { run } from "./exec";
import { createLimiter } from "./limit";

const limit = createLimiter(3);

const AUTH_HINTS = [/az login/i, /TF400813/, /401/, /token.*expired/i, /AADSTS/];

export async function az<T>(args: string[], cwd?: string): Promise<T> {
  let stdout: string;
  try {
    stdout = await limit(() => run("az", [...args, "-o", "json"], { cwd }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (AUTH_HINTS.some((hint) => hint.test(message))) {
      throw new Error("Azure CLI is not signed in. Run `az login` in a terminal and try again.");
    }
    throw new Error(message.split("\n")[0] ?? message);
  }
  return JSON.parse(stdout) as T;
}

export function git(args: string[], cwd: string): Promise<string> {
  return run("git", args, { cwd }).then((out) => out.trim());
}

// api urls look like https://dev.azure.com/{org}/{project-guid}/_apis/...; the web ui wants names
export function orgFromApiUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  const [org] = url.pathname.split("/").filter(Boolean);
  return `${url.origin}/${org}`;
}

export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    // block openers break lines too: ado wraps every paragraph in a div, headings included
    .replace(/<\/?(p|div|h[1-6]|tr|ul|ol)[^>]*>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
