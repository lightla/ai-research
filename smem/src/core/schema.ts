import { z } from "zod";

export const MemoryTypeSchema = z.enum([
  "decision",
  "context",
  "todo",
  "preference",
  "error",
  "note"
]);

export const MemoryStatusSchema = z.enum(["active", "pending-review", "rejected", "superseded", "archived"]);

export const MemoryInputSchema = z.object({
  type: MemoryTypeSchema.default("note"),
  title: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).default([]),
  status: MemoryStatusSchema.default("active")
});

export const MemoryRecordSchema = MemoryInputSchema.extend({
  id: z.string().min(1),
  projectId: z.string().min(1),
  scope: z.enum(["local", "global"]).default("local"),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  sourceKind: z.string().min(1).default("manual"),
  sourceAgent: z.string().optional(),
  source: z.record(z.string(), z.unknown()).default({})
});

export const ProjectRecordSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  rootPath: z.string().min(1),
  storePath: z.string().min(1),
  createdAt: z.string().min(1),
  lastSeenAt: z.string().min(1)
});

export type MemoryType = z.infer<typeof MemoryTypeSchema>;
export type MemoryInput = z.infer<typeof MemoryInputSchema>;
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;
