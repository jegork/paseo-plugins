import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const treeSettingsSchema = z.object({
  hideClosed: z.boolean().default(false),
  showDiffStats: z.boolean().default(true),
  showModel: z.boolean().default(true),
  showLastError: z.boolean().default(true),
  density: z.enum(["comfortable", "compact"]).default("comfortable"),
  sweepAgeDays: z.enum(["1", "3", "7", "30"]).default("7"),
});

export type TreeSettingsValues = z.output<typeof treeSettingsSchema>;

export const DEFAULT_TREE_SETTINGS: TreeSettingsValues = {
  hideClosed: false,
  showDiffStats: true,
  showModel: true,
  showLastError: true,
  density: "comfortable",
  sweepAgeDays: "7",
};

export const treeSettings = defineSettings({
  id: "tree",
  scope: "host",
  version: 1,
  schema: treeSettingsSchema,
});
