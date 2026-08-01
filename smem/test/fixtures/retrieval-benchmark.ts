import type { MemoryRecord } from "../../src/core/schema";

export const retrievalBenchmark: MemoryRecord[] = [
  {
    id: "mem_decision_storage",
    projectId: "proj_test",
    scope: "local",
    type: "decision",
    title: "Database storage",
    content: "Use SQLite in the outsider store for local memory.",
    tags: ["storage", "sqlite"],
    status: "active",
    sourceKind: "manual",
    source: {},
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z"
  },
  {
    id: "mem_todo_hooks",
    projectId: "proj_test",
    scope: "local",
    type: "todo",
    title: "Hook validation",
    content: "Validate Claude and Codex hook fixtures.",
    tags: ["hooks", "adapters"],
    status: "active",
    sourceKind: "manual",
    source: {},
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z"
  },
  {
    id: "mem_candidate_noise",
    projectId: "proj_test",
    scope: "local",
    type: "decision",
    title: "Unreviewed capture",
    content: "Use SQLite maybe.",
    tags: ["storage"],
    status: "pending-review",
    sourceKind: "raw-capture-candidate",
    source: { classification: { topics: ["storage"] } },
    createdAt: "2026-08-02T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z"
  }
];
