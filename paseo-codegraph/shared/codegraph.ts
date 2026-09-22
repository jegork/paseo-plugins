import { defineAttachmentSource, defineRpc, PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";
import { z } from "zod";

export const SymbolRefSchema = z.object({
  name: z.string(),
  kind: z.string(),
  filePath: z.string(),
  startLine: z.number().int(),
});

export const DependentSchema = SymbolRefSchema.extend({
  /** changed symbols whose impact reaches this node */
  via: z.array(z.string()),
});

export const AffectedFileSchema = z.object({
  filePath: z.string(),
  dependents: z.array(DependentSchema),
});

export const ChangedFileSchema = z.object({
  path: z.string(),
  /** false when the index has no record of the file (new, deleted or unparsed) */
  indexed: z.boolean(),
  symbols: z.array(SymbolRefSchema),
  /** eligible symbols beyond the per-file cap or dropped as ambiguous */
  skipped: z.number().int(),
});

export const ImpactReportSchema = z.object({
  indexed: z.boolean(),
  indexRoot: z.string().nullable(),
  directory: z.string().nullable(),
  baseRef: z.string().nullable(),
  signature: z.string(),
  changedFiles: z.array(ChangedFileSchema),
  affectedCode: z.array(AffectedFileSchema),
  affectedTests: z.array(AffectedFileSchema),
  filesSkipped: z.number().int(),
  errors: z.array(z.string()),
  takenAt: z.string(),
  cached: z.boolean(),
});

export type SymbolRef = z.output<typeof SymbolRefSchema>;
export type Dependent = z.output<typeof DependentSchema>;
export type AffectedFile = z.output<typeof AffectedFileSchema>;
export type ChangedFile = z.output<typeof ChangedFileSchema>;
export type ImpactReport = z.output<typeof ImpactReportSchema>;

export const impactReportRpc = defineRpc({
  name: "impact.report",
  input: z.object({ workspaceId: z.string(), force: z.boolean().optional() }),
  output: ImpactReportSchema,
});

export const searchSymbolsRpc = defineRpc({
  name: "symbols.search",
  input: z.object({ query: z.string() }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const symbolAttachments = defineAttachmentSource({
  id: "symbols",
  title: "Code graph",
  icon: "Waypoints",
  pickerTitle: "Attach code graph",
  searchPlaceholder: "Search symbols in open workspaces",
  search: searchSymbolsRpc,
});
