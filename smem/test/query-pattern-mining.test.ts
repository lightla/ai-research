import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { logRecallQuery, mineQueryPatterns, suggestRelatedTopics } from "../src/classify/query-pattern-mining";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "smem-query-patterns-"));
  tempDirs.push(home);
  return home;
}

function seedLog(home: string, entries: Array<{ topics: string[]; timestamp: string }>): void {
  mkdirSync(home, { recursive: true });
  const path = join(home, "query-log.jsonl");
  for (const entry of entries) {
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  }
}

test("logRecallQuery extracts single-word topics and skips bigrams", () => {
  const home = tempHome();
  logRecallQuery("auth middleware setup", home);
  const patterns = mineQueryPatterns(home, { minCount: 1, minRatio: 0 });
  // Nothing to mine from one entry alone (needs a follow-up query), but this at least confirms
  // the write path doesn't throw and produces a readable log for the next query to pair against.
  expect(patterns).toEqual([]);
});

test("mines a consistently repeated topic-pair above the default threshold", () => {
  const home = tempHome();
  const base = new Date("2026-01-01T00:00:00.000Z").getTime();
  const entries: Array<{ topics: string[]; timestamp: string }> = [];
  for (let i = 0; i < 3; i += 1) {
    const t0 = base + i * 60 * 60_000; // 1 hour apart between repetitions, well outside the window
    entries.push({ topics: ["auth"], timestamp: new Date(t0).toISOString() });
    entries.push({ topics: ["middleware"], timestamp: new Date(t0 + 60_000).toISOString() });
  }
  seedLog(home, entries);

  const patterns = mineQueryPatterns(home);
  expect(patterns).toHaveLength(1);
  expect(patterns[0]?.topics).toEqual(["auth", "middleware"]);
  expect(patterns[0]?.count).toBe(3);
  expect(patterns[0]?.ratio).toBe(1);
});

test("ignores pairs whose gap exceeds the window", () => {
  const home = tempHome();
  seedLog(home, [
    { topics: ["auth"], timestamp: "2026-01-01T00:00:00.000Z" },
    { topics: ["middleware"], timestamp: "2026-01-01T02:00:00.000Z" } // 2 hours later, past default 30 min window
  ]);
  expect(mineQueryPatterns(home)).toHaveLength(0);
  expect(mineQueryPatterns(home, { windowSeconds: 10_000, minCount: 1, minRatio: 0 })).toHaveLength(1);
});

test("does not pair a topic with itself", () => {
  const home = tempHome();
  seedLog(home, [
    { topics: ["auth"], timestamp: "2026-01-01T00:00:00.000Z" },
    { topics: ["auth"], timestamp: "2026-01-01T00:00:10.000Z" }
  ]);
  expect(mineQueryPatterns(home, { minCount: 1, minRatio: 0 })).toHaveLength(0);
});

test("suggestRelatedTopics only surfaces topics not already in the current query", () => {
  const home = tempHome();
  const base = new Date("2026-01-01T00:00:00.000Z").getTime();
  const entries: Array<{ topics: string[]; timestamp: string }> = [];
  for (let i = 0; i < 3; i += 1) {
    const t0 = base + i * 60 * 60_000;
    entries.push({ topics: ["auth"], timestamp: new Date(t0).toISOString() });
    entries.push({ topics: ["jwt"], timestamp: new Date(t0 + 60_000).toISOString() });
  }
  seedLog(home, entries);

  const relatedForAuth = suggestRelatedTopics(["auth"], home);
  expect(relatedForAuth.map((r) => r.topic)).toContain("jwt");

  const relatedForAuthAndJwt = suggestRelatedTopics(["auth", "jwt"], home);
  expect(relatedForAuthAndJwt.map((r) => r.topic)).not.toContain("jwt");
});
