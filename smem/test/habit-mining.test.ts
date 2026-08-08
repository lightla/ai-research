import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { logCommandInvocation, mineCommandHabits } from "../src/classify/habit-mining";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "smem-habits-"));
  tempDirs.push(home);
  return home;
}

// mineCommandHabits reads command-log.jsonl directly, so tests write controlled timestamps to it
// instead of racing real wall-clock gaps through logCommandInvocation.
function seedLog(home: string, entries: Array<{ command: string; timestamp: string }>): void {
  mkdirSync(home, { recursive: true });
  const path = join(home, "command-log.jsonl");
  for (const entry of entries) {
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  }
}

test("mines a consistently repeated sequence above the default threshold", () => {
  const home = tempHome();
  const base = new Date("2026-01-01T00:00:00.000Z").getTime();
  const entries: Array<{ command: string; timestamp: string }> = [];
  // 3 clean "recall -> store" sequences, spaced far enough apart from each other that they don't
  // form spurious pairs with each other (store[i] -> recall[i+1] must exceed the window).
  for (let i = 0; i < 3; i += 1) {
    const t0 = base + i * 10 * 60_000;
    entries.push({ command: "recall", timestamp: new Date(t0).toISOString() });
    entries.push({ command: "store", timestamp: new Date(t0 + 30_000).toISOString() });
  }
  seedLog(home, entries);

  const habits = mineCommandHabits(home);
  expect(habits).toHaveLength(1);
  expect(habits[0]?.steps).toEqual(["recall", "store"]);
  expect(habits[0]?.count).toBe(3);
  expect(habits[0]?.ratio).toBe(1);
});

test("ignores pairs whose gap exceeds the window", () => {
  const home = tempHome();
  seedLog(home, [
    { command: "recall", timestamp: "2026-01-01T00:00:00.000Z" },
    { command: "store", timestamp: "2026-01-01T01:00:00.000Z" } // 1 hour later, far past default 5 min window
  ]);

  expect(mineCommandHabits(home)).toHaveLength(0);
  expect(mineCommandHabits(home, { windowSeconds: 4000, minCount: 1, minRatio: 0 })).toHaveLength(1);
});

test("excludes 'hook run' from logging (internal, not a deliberate action)", () => {
  const home = tempHome();
  logCommandInvocation("hook run", home);
  logCommandInvocation("recall", home);
  const habits = mineCommandHabits(home, { minCount: 1, minRatio: 0 });
  // Only one real entry was ever logged, so there are no consecutive pairs to mine at all.
  expect(habits).toHaveLength(0);
});

test("below minCount, a rare sequence is not surfaced even at 100% ratio", () => {
  const home = tempHome();
  seedLog(home, [
    { command: "focus", timestamp: "2026-01-01T00:00:00.000Z" },
    { command: "recall", timestamp: "2026-01-01T00:00:10.000Z" }
  ]);
  expect(mineCommandHabits(home)).toHaveLength(0); // default minCount=3
  expect(mineCommandHabits(home, { minCount: 1, minRatio: 0 })).toHaveLength(1);
});

test("returns no habits on an empty or missing log", () => {
  const home = tempHome();
  expect(mineCommandHabits(home)).toHaveLength(0);
});
