import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { RegistryRepository } from "../src/storage/registry-repository";
import { MemoryRepository } from "../src/storage/memory-repository";
import { EmbeddingRepository } from "../src/storage/embedding-repository";
import type { EmbeddingClient } from "../src/embedding/embedding-client";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stores and recalls project memories", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-test-"));
  const projectDir = mkdtempSync(join(tmpdir(), "smem-project-"));
  tempDirs.push(home, projectDir);

  const registry = new RegistryRepository(home);
  const project = registry.initProject({ cwd: projectDir, name: "demo" });
  registry.close();

  const memories = new MemoryRepository(project);
  const created = memories.create({
    type: "decision",
    title: "Outsider store",
    content: "Default storage does not write files into company repos.",
    tags: ["storage", "mvp"],
    status: "active"
  });

  expect(created.id).toMatch(/^mem_/);
  expect(memories.recall("outsider")).toHaveLength(1);
  expect(memories.contains("company repos")).toHaveLength(1);
  expect(memories.context()).toContain("Outsider store");
  memories.close();
});

test("recalls terms containing fts operator characters", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-test-"));
  const projectDir = mkdtempSync(join(tmpdir(), "smem-project-"));
  tempDirs.push(home, projectDir);

  const registry = new RegistryRepository(home);
  const project = registry.initProject({ cwd: projectDir, name: "demo" });
  registry.close();

  const memories = new MemoryRepository(project, { home });
  memories.create({
    type: "note",
    content: "Captured test token stest-k001 for recall validation.",
    tags: [],
    status: "active"
  });

  expect(memories.recall("stest-k001")).toHaveLength(1);

  memories.close();
});

test("keeps global memories separate from local project memories", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-test-"));
  const projectDir = mkdtempSync(join(tmpdir(), "smem-project-"));
  tempDirs.push(home, projectDir);

  const registry = new RegistryRepository(home);
  const project = registry.initProject({ cwd: projectDir, name: "demo" });
  registry.close();

  const local = new MemoryRepository(project, { home });
  const global = new MemoryRepository(project, { scope: "global", home });

  local.create({
    type: "context",
    title: "Local architecture",
    content: "This project uses outsider storage.",
    tags: ["local"],
    status: "active"
  });

  const globalMemory = global.create({
    type: "preference",
    title: "Commit style",
    content: "Use conventional commits.",
    tags: ["global"],
    status: "active"
  });

  expect(globalMemory.scope).toBe("global");
  expect(globalMemory.projectId).toBe("global");
  expect(local.recall("conventional")).toHaveLength(0);
  expect(global.recall("conventional")).toHaveLength(1);
  expect(global.context()).toContain("Scope: global");

  local.close();
  global.close();
});

test("moves project root by id or current path", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-test-"));
  const oldProjectDir = mkdtempSync(join(tmpdir(), "smem-project-old-"));
  const newProjectDir = mkdtempSync(join(tmpdir(), "smem-project-new-"));
  const movedAgainDir = mkdtempSync(join(tmpdir(), "smem-project-moved-"));
  tempDirs.push(home, oldProjectDir, newProjectDir, movedAgainDir);

  const registry = new RegistryRepository(home);
  const project = registry.initProject({ cwd: oldProjectDir, name: "demo" });

  const attachedFromPath = registry.attachProjectFromPath({
    cwd: newProjectDir,
    fromPath: oldProjectDir
  });
  expect(attachedFromPath.projectId).toBe(project.projectId);
  expect(attachedFromPath.rootPath).toBe(newProjectDir);
  expect(registry.findByPath(oldProjectDir)).toBeNull();
  expect(registry.findByPath(newProjectDir)?.projectId).toBe(project.projectId);

  const attached = registry.attachProject({ cwd: movedAgainDir, projectId: project.projectId });
  expect(attached.projectId).toBe(project.projectId);
  expect(attached.rootPath).toBe(movedAgainDir);
  expect(registry.findByPath(oldProjectDir)).toBeNull();
  expect(registry.findByPath(newProjectDir)).toBeNull();
  expect(registry.findByPath(movedAgainDir)?.projectId).toBe(project.projectId);

  registry.close();
});

test("requires deleting accidental project before moving another project to its path", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-test-"));
  const oldProjectDir = mkdtempSync(join(tmpdir(), "smem-project-old-"));
  const accidentalDir = mkdtempSync(join(tmpdir(), "smem-project-accidental-"));
  tempDirs.push(home, oldProjectDir, accidentalDir);

  const registry = new RegistryRepository(home);
  const original = registry.initProject({ cwd: oldProjectDir, name: "original" });
  const accidental = registry.initProject({ cwd: accidentalDir, name: "accidental" });

  expect(() => registry.attachProject({ cwd: accidentalDir, projectId: original.projectId })).toThrow(
    accidental.projectId
  );

  const deleted = registry.deleteProject(accidental.projectId);
  expect(deleted.projectId).toBe(accidental.projectId);
  expect(existsSync(accidental.storePath)).toBe(false);

  const moved = registry.attachProject({ cwd: accidentalDir, projectId: original.projectId });
  expect(moved.projectId).toBe(original.projectId);
  expect(registry.findByPath(accidentalDir)?.projectId).toBe(original.projectId);
  expect(registry.findById(accidental.projectId)).toBeNull();

  registry.close();
});

test("indexes and searches semantic vectors with an embedding client", async () => {
  const home = mkdtempSync(join(tmpdir(), "smem-test-"));
  const projectDir = mkdtempSync(join(tmpdir(), "smem-project-"));
  tempDirs.push(home, projectDir);

  const registry = new RegistryRepository(home);
  const project = registry.initProject({ cwd: projectDir, name: "demo" });
  registry.close();

  const memories = new MemoryRepository(project, { home });
  const embeddings = new EmbeddingRepository(project, { home });
  const client: EmbeddingClient = {
    provider: "openai",
    model: "fake-embedding",
    async embed(input: string[]): Promise<number[][]> {
      return input.map((text) => (text.toLowerCase().includes("commit") ? [1, 0] : [0, 1]));
    }
  };

  const memory = memories.create({
    type: "preference",
    title: "Commit style",
    content: "Use conventional commits.",
    tags: ["workflow"],
    status: "active"
  });

  await embeddings.index(memories.allActive(), client);
  const [result] = await embeddings.search("commit message style", client, 1);

  expect(result?.memoryId).toBe(memory.id);
  expect(result?.score).toBeGreaterThan(0.9);

  memories.close();
  embeddings.close();
});
