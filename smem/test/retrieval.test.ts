import { expect, test } from "vitest";
import { retrievalBenchmark } from "./fixtures/retrieval-benchmark";
import { rankMemories } from "../src/retrieval/retrieval";

test("ranks deterministic official results and excludes candidates by default", () => {
  const results = rankMemories(retrievalBenchmark, { query: "SQLite storage", limit: 10 });

  expect(results.map((result) => result.memory.id)).toEqual(["mem_decision_storage"]);
  expect(results[0]?.reason.matches).toEqual(expect.arrayContaining(["content:sqlite", "tag:sqlite"]));
});

test("filters by type, tag, topic, and status", () => {
  expect(rankMemories(retrievalBenchmark, { query: "", type: "todo" })[0]?.memory.id).toBe("mem_todo_hooks");
  expect(rankMemories(retrievalBenchmark, { query: "", tag: "storage" })[0]?.memory.id).toBe("mem_decision_storage");
  expect(rankMemories(retrievalBenchmark, { query: "", topic: "storage", status: "pending-review" })[0]?.memory.id).toBe("mem_candidate_noise");
});

test("uses stable id ordering when score and timestamp are equal", () => {
  const first = { ...retrievalBenchmark[0]!, id: "mem_a" };
  const second = { ...retrievalBenchmark[0]!, id: "mem_b" };
  const results = rankMemories([second, first], { query: "" });
  expect(results.map((result) => result.memory.id)).toEqual(["mem_a", "mem_b"]);
});
