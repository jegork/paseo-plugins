import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { searchDashboards } from "../shared/grafana";
import { currentContext, gcx } from "./gcx";

interface DashboardHit {
  metadata: { name: string };
  spec: { title: string; folder?: string; tags?: string[] };
}

interface Dashboard {
  metadata: { name: string; annotations?: Record<string, string> };
  spec: { title: string; description?: string; tags?: string[]; panels?: { title?: string; type?: string }[] };
}

export async function search({ query }: RpcInput<typeof searchDashboards>): Promise<RpcOutput<typeof searchDashboards>> {
  const trimmed = query.trim();
  const [context, result] = await Promise.all([
    currentContext(),
    trimmed
      ? gcx<{ items: DashboardHit[] }>(["dashboards", "search", trimmed])
      : gcx<{ items: Dashboard[] }>(["dashboards", "list"]).then((listed) => ({
          items: listed.items.map((d) => ({
            metadata: { name: d.metadata.name },
            spec: { title: d.spec.title, folder: d.metadata.annotations?.["grafana.app/folder"], tags: d.spec.tags },
          })),
        })),
  ]);
  const hits = result.items.slice(0, 10);
  // the search hit carries only title/folder/tags; the description and panel list need the full dashboard
  const details = await Promise.all(
    hits.map((hit) => gcx<Dashboard>(["dashboards", "get", hit.metadata.name]).catch(() => null)),
  );
  return {
    items: hits.map((hit, index) => {
      const full = details[index];
      const uid = hit.metadata.name;
      const url = `${context.server}/d/${uid}`;
      const panels = (full?.spec.panels ?? []).map((panel) => panel.title).filter(Boolean);
      const text = [
        `Grafana dashboard: ${hit.spec.title} (uid ${uid})`,
        hit.spec.folder ? `Folder: ${hit.spec.folder}` : "",
        hit.spec.tags?.length ? `Tags: ${hit.spec.tags.join(", ")}` : "",
        `URL: ${url}`,
        full?.spec.description ? `\n${full.spec.description}` : "",
        panels.length ? `\nPanels: ${panels.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      // the picker row is `identifier title`; uids are hashes for provisioned dashboards, so keep the row to the title
      const folderIsUid = !hit.spec.folder || /^[a-zA-Z0-9]{9,}$/.test(hit.spec.folder);
      return {
        id: uid,
        identifier: "",
        title: hit.spec.title,
        subtitle: folderIsUid ? hit.spec.tags?.slice(0, 3).join(", ") : hit.spec.folder,
        url,
        text,
        resourceType: "dashboard",
      };
    }),
  };
}
