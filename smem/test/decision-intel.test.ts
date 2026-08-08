import { expect, test } from "vitest";
import { extractDecisionComponents, findOverlappingDecisions } from "../src/classify/decision-intel";
import type { MemoryRecord } from "../src/core/schema";

test("extracts 'chose X over Y because Z' (English)", () => {
  const result = extractDecisionComponents("We chose PostgreSQL over MongoDB because we need ACID transactions.");
  expect(result?.chosen).toBe("PostgreSQL");
  expect(result?.rejectedAlternatives).toEqual(["MongoDB"]);
  expect(result?.reasoning).toBe("we need ACID transactions");
});

test("extracts 'chọn X thay vì Y vì Z' (Vietnamese)", () => {
  const result = extractDecisionComponents("Chốt dùng SQLite thay vì Postgres vì cần offline-first.");
  expect(result?.chosen).toBe("SQLite");
  expect(result?.rejectedAlternatives).toEqual(["Postgres"]);
  expect(result?.reasoning).toBe("cần offline-first");
});

test("extracts 'decided to X because Y'", () => {
  const result = extractDecisionComponents("We decided to use RS256 because it scales better across services.");
  expect(result?.chosen).toBe("use RS256");
  expect(result?.reasoning).toBe("it scales better across services");
});

test("extracts standalone rejection mentions", () => {
  const result = extractDecisionComponents("Rejected MongoDB because it lacks strong consistency.");
  expect(result?.rejectedAlternatives).toEqual(["MongoDB"]);
  expect(result?.reasoning).toBe("it lacks strong consistency");
});

test("returns null when no decision shape is recognized", () => {
  expect(extractDecisionComponents("Fixed a typo in the README.")).toBeNull();
  expect(extractDecisionComponents("")).toBeNull();
});

function decisionMemory(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: "mem_old",
    projectId: "proj_test",
    scope: "local",
    type: "decision",
    content: "content",
    tags: [],
    status: "active",
    sourceKind: "manual",
    source: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

test("findOverlappingDecisions: same chosen + shared tags scores as confirms", () => {
  const overlaps = findOverlappingDecisions(
    { chosen: "PostgreSQL", rejectedAlternatives: [] },
    ["storage", "database"],
    [decisionMemory({ decision: { chosen: "PostgreSQL", rejectedAlternatives: [] }, tags: ["storage", "database"] })]
  );
  expect(overlaps).toHaveLength(1);
  expect(overlaps[0]?.relationship).toBe("confirms");
});

test("findOverlappingDecisions: new chosen is old's rejected alternative scores as contradicts", () => {
  const overlaps = findOverlappingDecisions(
    { chosen: "MongoDB", rejectedAlternatives: [] },
    ["storage", "database"],
    [decisionMemory({ decision: { chosen: "PostgreSQL", rejectedAlternatives: ["MongoDB"] }, tags: ["storage", "database"] })]
  );
  expect(overlaps).toHaveLength(1);
  expect(overlaps[0]?.relationship).toBe("contradicts");
});

test("findOverlappingDecisions: below threshold is excluded", () => {
  const overlaps = findOverlappingDecisions(
    { chosen: "PostgreSQL", rejectedAlternatives: [] },
    ["storage"],
    [decisionMemory({ decision: { chosen: "React", rejectedAlternatives: [] }, tags: ["frontend"] })]
  );
  expect(overlaps).toHaveLength(0);
});

test("findOverlappingDecisions: respects limit and sorts by score descending", () => {
  const overlaps = findOverlappingDecisions(
    { chosen: "SQLite", rejectedAlternatives: [] },
    ["storage", "database", "offline"],
    [
      decisionMemory({ id: "mem_a", decision: { chosen: "SQLite", rejectedAlternatives: [] }, tags: ["storage", "database", "offline"] }),
      decisionMemory({ id: "mem_b", decision: { chosen: "Something", rejectedAlternatives: [] }, tags: ["storage"] })
    ],
    { limit: 1 }
  );
  expect(overlaps).toHaveLength(1);
  expect(overlaps[0]?.memoryId).toBe("mem_a");
});
