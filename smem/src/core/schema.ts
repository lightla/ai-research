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

// Structured fields for type="decision" memories: "chose X over Y because Z". Either given
// explicitly (--chosen/--rejected/--reason on `smem store`) or auto-extracted from free-text
// content by decision-intel.ts when omitted — see that module for why this doesn't need an LLM.
export const DecisionComponentsSchema = z.object({
  chosen: z.string().trim().min(1).optional(),
  rejectedAlternatives: z.array(z.string().trim().min(1)).default([]),
  reasoning: z.string().trim().min(1).optional()
});

export const MemoryInputSchema = z.object({
  type: MemoryTypeSchema.default("note"),
  namespace: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).default([]),
  status: MemoryStatusSchema.default("active"),
  decision: DecisionComponentsSchema.optional()
});

export const MemoryRecordSchema = MemoryInputSchema.extend({
  id: z.string().min(1),
  projectId: z.string().min(1),
  scope: z.enum(["local", "global"]).default("local"),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  sourceKind: z.string().min(1).default("manual"),
  sourceAgent: z.string().optional(),
  source: z.record(z.string(), z.unknown()).default({}),
  // Set by `smem supersede <old-id> --by <new-id>` — never inferred automatically. Overlap
  // detection only ever *suggests*; a human still decides whether one decision replaces another.
  supersededBy: z.string().min(1).optional()
});

export type DecisionComponents = z.infer<typeof DecisionComponentsSchema>;

// Domain graph — macro/meso tiers only. Class/file/call-level relations are deliberately not
// modeled here: that structural detail drifts from the real code too fast to keep in sync, so
// it stays out of storage and gets resolved on demand by the agent's own code-reading tools
// (Grep/Read), using an entity's `codeRef` as a breadcrumb rather than a stored call graph.
export const EntityTypeSchema = z.enum(["module", "domain_object", "decision", "constraint"]);

export const RelationTypeSchema = z.enum([
  "DEPENDS_ON",
  "CONTAINS",
  "COMMUNICATES_VIA",
  "IMPACTS",
  "RESOLVES",
  "REFERENCES"
]);

export const EntityInputSchema = z.object({
  type: EntityTypeSchema,
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  codeRef: z.string().trim().min(1).optional()
});

export const EntityRecordSchema = EntityInputSchema.extend({
  id: z.string().min(1),
  projectId: z.string().min(1),
  scope: z.enum(["local", "global"]).default("local"),
  slug: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

// `fromEntity`/`toEntity` accept a name or slug; the repository resolves them against existing
// entities and refuses to silently create new ones with a guessed type.
export const RelationInputSchema = z.object({
  fromEntity: z.string().trim().min(1),
  toEntity: z.string().trim().min(1),
  type: RelationTypeSchema,
  detail: z.string().trim().min(1).optional()
});

export const RelationRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  scope: z.enum(["local", "global"]).default("local"),
  fromEntityId: z.string().min(1),
  toEntityId: z.string().min(1),
  type: RelationTypeSchema,
  detail: z.string().min(1).optional(),
  createdAt: z.string().min(1)
});

export type EntityType = z.infer<typeof EntityTypeSchema>;
export type EntityInput = z.infer<typeof EntityInputSchema>;
export type EntityRecord = z.infer<typeof EntityRecordSchema>;
export type RelationType = z.infer<typeof RelationTypeSchema>;
export type RelationInput = z.infer<typeof RelationInputSchema>;
export type RelationRecord = z.infer<typeof RelationRecordSchema>;

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
