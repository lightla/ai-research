import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { writeMarkdownRender } from "../src/render/markdown";
import type { MemoryRecord, ProjectRecord } from "../src/core/schema";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renders index, type, and tag markdown views", () => {
  const storePath = mkdtempSync(join(tmpdir(), "smem-render-"));
  tempDirs.push(storePath);
  const project: ProjectRecord = {
    projectId: "proj_test",
    projectName: "demo",
    rootPath: "/tmp/demo",
    storePath,
    createdAt: "2026-08-02T00:00:00Z",
    lastSeenAt: "2026-08-02T00:00:00Z"
  };
  const memory: MemoryRecord = {
    id: "mem_test",
    projectId: project.projectId,
    scope: "local",
    type: "decision",
    title: "Storage",
    content: "Use SQLite.",
    tags: ["storage"],
    status: "active",
    sourceKind: "manual",
    source: {},
    createdAt: project.createdAt,
    updatedAt: project.lastSeenAt
  };

  const indexPath = writeMarkdownRender(project, [memory]);
  expect(readFileSync(indexPath, "utf8")).toContain("types/decision.md");
  expect(existsSync(join(storePath, "rendered", "types", "decision.md"))).toBe(true);
  expect(existsSync(join(storePath, "rendered", "tags", "storage.md"))).toBe(true);
  expect(readFileSync(join(storePath, "rendered", "tags", "index.md"), "utf8")).toContain("storage.md");
});
