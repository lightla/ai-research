import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { addLexiconWord, buildLexiconPattern, loadLexicon, removeLexiconWord, resetLexicon } from "../src/classify/lexicon";
import { classifyText } from "../src/classify/offline-classifier";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "smem-lexicon-"));
  tempDirs.push(home);
  return home;
}

test("loadLexicon returns the built-in defaults without writing a file", () => {
  const home = tempHome();
  const lexicon = loadLexicon(home);
  expect(lexicon.decision).toContain("chốt");
  expect(lexicon.decision).toContain("decision");
});

test("addLexiconWord persists and is picked up by classifyText", () => {
  const home = tempHome();

  expect(classifyText("mình nghĩ nên dùng SQLite ở đây", home).primaryLabel).toBe("note");

  addLexiconWord("decision", "mình nghĩ nên", home);
  const result = classifyText("mình nghĩ nên dùng SQLite ở đây", home);
  expect(result.labels).toContain("decision");
});

test("addLexiconWord is idempotent (case-insensitive)", () => {
  const home = tempHome();
  addLexiconWord("todo", "cần deploy", home);
  addLexiconWord("todo", "Cần Deploy", home);
  const lexicon = loadLexicon(home);
  expect(lexicon.todo.filter((w) => w.toLowerCase() === "cần deploy").length).toBe(1);
});

test("removeLexiconWord removes a word without affecting others", () => {
  const home = tempHome();
  addLexiconWord("error", "sập hệ thống", home);
  removeLexiconWord("error", "sập hệ thống", home);
  const lexicon = loadLexicon(home);
  expect(lexicon.error).not.toContain("sập hệ thống");
  expect(lexicon.error).toContain("error");
});

test("resetLexicon discards learned words", () => {
  const home = tempHome();
  addLexiconWord("context", "bối cảnh riêng", home);
  resetLexicon(home);
  const lexicon = loadLexicon(home);
  expect(lexicon.context).not.toContain("bối cảnh riêng");
});

test("buildLexiconPattern returns undefined for an empty word list", () => {
  const home = tempHome();
  const lexicon = loadLexicon(home);
  lexicon.decision = [];
  expect(buildLexiconPattern(lexicon, "decision")).toBeUndefined();
});
