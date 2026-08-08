import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { RegistryRepository } from "../src/storage/registry-repository";
import { MemoryRepository } from "../src/storage/memory-repository";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function setupRepo() {
  const home = mkdtempSync(join(tmpdir(), "smem-merge-test-"));
  const projectDir = mkdtempSync(join(tmpdir(), "smem-merge-project-"));
  tempDirs.push(home, projectDir);

  const registry = new RegistryRepository(home);
  const project = registry.initProject({ cwd: projectDir, name: "demo" });
  registry.close();

  return new MemoryRepository(project, { home });
}

test("findPromotedRawIds finds every raw id merged into an official memory", () => {
  const repo = setupRepo();
  const memory = repo.create(
    { type: "decision", title: "Merged decision", content: "Combined content from 3 messages.", tags: [], status: "active" },
    {
      sourceKind: "history-merge",
      source: {
        mergedFrom: [
          { id: "evt_a", kind: "event" },
          { id: "trs_b", kind: "transcript" },
          { id: "trs_c", kind: "transcript" }
        ]
      }
    }
  );

  const result = repo.findPromotedRawIds(["evt_a", "trs_b", "trs_c", "evt_not_merged"]);
  expect(Object.keys(result).sort()).toEqual(["evt_a", "trs_b", "trs_c"]);
  expect(result["evt_a"]?.memoryId).toBe(memory.id);
  expect(result["evt_a"]?.title).toBe("Merged decision");
  expect(result["trs_b"]?.memoryId).toBe(memory.id);

  repo.close();
});

test("findPromotedRawIds returns empty for an empty input list", () => {
  const repo = setupRepo();
  expect(repo.findPromotedRawIds([])).toEqual({});
  repo.close();
});

test("findPromotedRawIds ignores memories with no mergedFrom source", () => {
  const repo = setupRepo();
  repo.create({ type: "note", content: "Unrelated manual note.", tags: [], status: "active" });
  expect(repo.findPromotedRawIds(["some_raw_id"])).toEqual({});
  repo.close();
});

test("findPromotedRawIds ignores archived/non-active memories", () => {
  const repo = setupRepo();
  const memory = repo.create(
    { type: "note", content: "Will be archived.", tags: [], status: "active" },
    { source: { mergedFrom: [{ id: "evt_x", kind: "event" }] } }
  );
  repo.archive(memory.id);

  expect(repo.findPromotedRawIds(["evt_x"])).toEqual({});
  repo.close();
});
