import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { RegistryRepository } from "../src/storage/registry-repository";
import { MemoryRepository } from "../src/storage/memory-repository";
import { processCandidates } from "../src/process/candidate-processor";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("processes legacy raw events that do not have classifier metadata", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-test-"));
  const projectDir = mkdtempSync(join(tmpdir(), "smem-project-"));
  tempDirs.push(home, projectDir);

  const registry = new RegistryRepository(home);
  const project = registry.initProject({ cwd: projectDir, name: "demo" });
  registry.close();

  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    `${JSON.stringify({
      agent: "antigravity",
      event: "PreInvocation",
      sessionId: "legacy-session",
      projectPath: projectDir,
      signal: "high",
      payload: {
        prompt: "chốt dùng SQLite cho database storage"
      }
    })}\n`,
    "utf8"
  );

  const result = processCandidates({ project, scope: "local", home });
  const memories = new MemoryRepository(project, { home });

  expect(result).toEqual({ scanned: 1, created: 1, skipped: 0 });
  expect(memories.listCandidates()).toHaveLength(1);

  memories.close();
});

test("skips metadata-only hook events", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-test-"));
  const projectDir = mkdtempSync(join(tmpdir(), "smem-project-"));
  tempDirs.push(home, projectDir);

  const registry = new RegistryRepository(home);
  const project = registry.initProject({ cwd: projectDir, name: "demo" });
  registry.close();

  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    `${JSON.stringify({
      agent: "antigravity",
      event: "Stop",
      sessionId: "metadata-session",
      projectPath: projectDir,
      signal: "low",
      payload: {
        error: "",
        terminationReason: "NO_TOOL_CALL",
        workspacePaths: [projectDir]
      }
    })}\n`,
    "utf8"
  );

  const result = processCandidates({ project, scope: "local", home });

  expect(result).toEqual({ scanned: 1, created: 0, skipped: 1 });
});

test("skips tool-only hook events instead of creating noisy candidates", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-test-"));
  const projectDir = mkdtempSync(join(tmpdir(), "smem-project-"));
  tempDirs.push(home, projectDir);

  const registry = new RegistryRepository(home);
  const project = registry.initProject({ cwd: projectDir, name: "demo" });
  registry.close();

  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    `${JSON.stringify({
      eventId: "evt_tool_only",
      agent: "antigravity",
      event: "PostToolUse",
      captureKind: "tool-event",
      sessionId: "tool-session",
      projectPath: projectDir,
      signal: "high",
      classification: {
        labels: ["todo"],
        primaryLabel: "todo",
        topics: ["grep"],
        keywords: ["grep"],
        entities: [],
        languageHint: "en",
        classifier: {
          kind: "wink-nlp",
          version: "test",
          confidence: 0.95
        }
      },
      payload: {
        toolCall: {
          args: {
            CommandLine: "grep stest-k001 pending.jsonl",
            toolSummary: "Grep hook log"
          }
        }
      }
    })}\n`,
    "utf8"
  );

  const result = processCandidates({ project, scope: "local", home });

  expect(result).toEqual({ scanned: 1, created: 0, skipped: 1 });
});
