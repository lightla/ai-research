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
  const home = mkdtempSync(join(tmpdir(), "smem-decision-test-"));
  const projectDir = mkdtempSync(join(tmpdir(), "smem-decision-project-"));
  tempDirs.push(home, projectDir);

  const registry = new RegistryRepository(home);
  const project = registry.initProject({ cwd: projectDir, name: "demo" });
  registry.close();

  return new MemoryRepository(project, { home });
}

test("create() auto-extracts decision components from content when not given explicitly", () => {
  const repo = setupRepo();
  const memory = repo.create({
    type: "decision",
    content: "Chốt dùng SQLite thay vì Postgres vì cần offline-first.",
    tags: [],
    status: "active"
  });

  expect(memory.decision?.chosen).toBe("SQLite");
  expect(memory.decision?.rejectedAlternatives).toEqual(["Postgres"]);

  // Round-trips through getById (decision_json column), not just the in-memory return value.
  const reloaded = repo.getById(memory.id);
  expect(reloaded?.decision?.chosen).toBe("SQLite");
  repo.close();
});

test("create() prefers explicit decision fields over regex extraction", () => {
  const repo = setupRepo();
  const memory = repo.create({
    type: "decision",
    content: "Some free text that would otherwise not match any pattern.",
    tags: [],
    status: "active",
    decision: { chosen: "SQLite", rejectedAlternatives: ["Postgres"], reasoning: "explicit" }
  });

  expect(memory.decision?.chosen).toBe("SQLite");
  expect(memory.decision?.reasoning).toBe("explicit");
  repo.close();
});

test("findDecisionOverlaps surfaces a prior active decision and excludeId omits the new record itself", () => {
  const repo = setupRepo();
  const old = repo.create({
    type: "decision",
    content: "Chốt dùng PostgreSQL cho storage.",
    tags: ["storage", "database"],
    status: "active",
    decision: { chosen: "PostgreSQL", rejectedAlternatives: [] }
  });

  const overlaps = repo.findDecisionOverlaps({ chosen: "PostgreSQL", rejectedAlternatives: [] }, ["storage", "database"], {
    excludeId: "mem_should_not_matter"
  });
  expect(overlaps.map((o) => o.memoryId)).toContain(old.id);
  repo.close();
});

test("supersede marks the old memory superseded and links supersededBy", () => {
  const repo = setupRepo();
  const old = repo.create({
    type: "decision",
    content: "Chốt dùng MongoDB cho storage.",
    tags: ["storage"],
    status: "active"
  });
  const replacement = repo.create({
    type: "decision",
    content: "Chốt dùng PostgreSQL thay vì MongoDB vì cần ACID.",
    tags: ["storage"],
    status: "active"
  });

  const updated = repo.supersede(old.id, replacement.id);
  expect(updated.status).toBe("superseded");
  expect(updated.supersededBy).toBe(replacement.id);

  // Superseded memories drop out of normal active-only reads.
  expect(repo.allActive().some((m) => m.id === old.id)).toBe(false);
  repo.close();
});

test("supersede rejects a non-active old memory and a missing replacement", () => {
  const repo = setupRepo();
  const old = repo.create({ type: "decision", content: "x", tags: [], status: "active" });
  const replacement = repo.create({ type: "decision", content: "y", tags: [], status: "active" });

  expect(() => repo.supersede(old.id, "mem_missing")).toThrow(/Replacement memory not found/);
  repo.supersede(old.id, replacement.id);
  expect(() => repo.supersede(old.id, replacement.id)).toThrow(/Only active memories can be superseded/);
  repo.close();
});

test("export/import round-trips decision components and supersededBy losslessly", () => {
  const repo = setupRepo();
  const old = repo.create({
    type: "decision",
    content: "Chốt dùng MongoDB.",
    tags: ["storage"],
    status: "active"
  });
  const replacement = repo.create({
    type: "decision",
    content: "Chốt dùng PostgreSQL thay vì MongoDB vì cần ACID.",
    tags: ["storage"],
    status: "active",
    decision: { chosen: "PostgreSQL", rejectedAlternatives: ["MongoDB"], reasoning: "cần ACID" }
  });
  repo.supersede(old.id, replacement.id);

  const exported = [repo.getById(old.id)!, repo.getById(replacement.id)!];

  const home2 = mkdtempSync(join(tmpdir(), "smem-decision-import-"));
  const projectDir2 = mkdtempSync(join(tmpdir(), "smem-decision-import-project-"));
  tempDirs.push(home2, projectDir2);
  const registry2 = new RegistryRepository(home2);
  const project2 = registry2.initProject({ cwd: projectDir2, name: "demo2" });
  registry2.close();
  const repo2 = new MemoryRepository(project2, { home: home2 });

  const result = repo2.importRecords(exported.map((memory) => ({ ...memory, projectId: project2.projectId })));
  expect(result.imported).toBe(2);

  const reimportedOld = repo2.getById(old.id);
  const reimportedNew = repo2.getById(replacement.id);
  expect(reimportedOld?.status).toBe("superseded");
  expect(reimportedOld?.supersededBy).toBe(replacement.id);
  expect(reimportedNew?.decision?.chosen).toBe("PostgreSQL");
  expect(reimportedNew?.decision?.rejectedAlternatives).toEqual(["MongoDB"]);

  repo.close();
  repo2.close();
});
