import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { dismissLexiconSuggestion, listLexiconSuggestions, recordPromotionSignal } from "../src/classify/lexicon-learning";
import type { MemoryRecord } from "../src/core/schema";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "smem-lexicon-learning-"));
  tempDirs.push(home);
  return home;
}

function memory(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: "mem_test",
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

test("no-op for memory types without a lexicon category", () => {
  const home = tempHome();
  recordPromotionSignal(memory({ type: "note", content: "bất kỳ nội dung nào cũng được" }), home);
  expect(listLexiconSuggestions(home, { minCount: 1, minRatio: 0 })).toHaveLength(0);
});

test("does not learn from content the lexicon already explains", () => {
  const home = tempHome();
  recordPromotionSignal(memory({ type: "decision", content: "chốt dùng PostgreSQL" }), home);
  expect(listLexiconSuggestions(home, { minCount: 1, minRatio: 0 })).toHaveLength(0);
});

test("counts keywords from unexplained promotions and surfaces them past the default threshold", () => {
  const home = tempHome();
  for (let i = 0; i < 3; i += 1) {
    recordPromotionSignal(memory({ type: "decision", content: "mình nghĩ nên dùng SQLite cho storage lần này" }), home);
  }

  const suggestions = listLexiconSuggestions(home);
  const words = suggestions.filter((s) => s.category === "decision").map((s) => s.word);
  expect(words).toContain("nghĩ");
  expect(words.every((w) => !w.includes(" "))).toBe(true);
  const nghi = suggestions.find((s) => s.word === "nghĩ");
  expect(nghi?.total).toBe(3);
  expect(nghi?.ratio).toBe(1);
});

test("below minCount, nothing is suggested yet even at 100% ratio", () => {
  const home = tempHome();
  recordPromotionSignal(memory({ type: "todo", content: "nhắc mình dọn dẹp repo sau" }), home);
  expect(listLexiconSuggestions(home)).toHaveLength(0); // default minCount=3
  expect(listLexiconSuggestions(home, { minCount: 1, minRatio: 0 }).length).toBeGreaterThan(0);
});

test("ratio drops once the word stops being confirmed on later unrelated promotions", () => {
  const home = tempHome();
  for (let i = 0; i < 3; i += 1) {
    recordPromotionSignal(memory({ type: "decision", content: "mình nghĩ nên dùng SQLite cho storage" }), home);
  }
  // 7 more decisions confirmed that don't mention "nghĩ" at all (still unexplained by lexicon,
  // so they count toward `total` but not toward the "nghĩ" word count) -> ratio dilutes to 3/10.
  for (let i = 0; i < 7; i += 1) {
    recordPromotionSignal(memory({ type: "decision", content: `mua ca phe lan ${i}` }), home);
  }

  const nghi = listLexiconSuggestions(home, { minCount: 1, minRatio: 0 }).find((s) => s.word === "nghĩ");
  expect(nghi?.total).toBe(10);
  expect(nghi?.count).toBe(3);
  expect(nghi?.ratio).toBeCloseTo(0.3, 5);
  // No longer clears the default 15% floor by enough margin to matter here, but a stricter
  // ratio requirement (e.g. 50%) now correctly excludes it despite the raw count still being 3.
  expect(listLexiconSuggestions(home, { minCount: 3, minRatio: 0.5 }).some((s) => s.word === "nghĩ")).toBe(false);
});

test("dismissLexiconSuggestion clears the counter", () => {
  const home = tempHome();
  for (let i = 0; i < 3; i += 1) {
    recordPromotionSignal(memory({ type: "todo", content: "nhắc mình dọn dẹp repo sau" }), home);
  }
  expect(listLexiconSuggestions(home).some((s) => s.word === "nhắc")).toBe(true);

  dismissLexiconSuggestion("todo", "nhắc", home);
  expect(listLexiconSuggestions(home, { minCount: 1, minRatio: 0 }).some((s) => s.word === "nhắc")).toBe(false);
});
