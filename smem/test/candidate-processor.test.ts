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

  expect(result).toEqual({ scanned: 1, created: 1, skipped: 0, skippedByReason: { "no-text": 0, "low-confidence": 0, "wrong-project": 0, "unsupported-label": 0, duplicate: 0 } });
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

  expect(result).toEqual({ scanned: 1, created: 0, skipped: 1, skippedByReason: { "no-text": 1, "low-confidence": 0, "wrong-project": 0, "unsupported-label": 0, duplicate: 0 } });
});

test("uses referenced transcript text when a hook payload contains metadata only", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-test-"));
  const projectDir = mkdtempSync(join(tmpdir(), "smem-project-"));
  tempDirs.push(home, projectDir);

  const registry = new RegistryRepository(home);
  const project = registry.initProject({ cwd: projectDir, name: "demo" });
  registry.close();

  const transcriptPath = join(home, "antigravity-cli", "transcript_full.jsonl");
  mkdirSync(join(home, "antigravity-cli"), { recursive: true });
  writeFileSync(
    transcriptPath,
    `${JSON.stringify({ source: "USER_EXPLICIT", type: "USER_INPUT", created_at: "2026-08-01T00:00:00Z", content: "quyết định dùng SQLite cho memory" })}\n`,
    "utf8"
  );
  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    `${JSON.stringify({
      eventId: "evt_transcript_fallback",
      agent: "antigravity",
      event: "PreInvocation",
      captureKind: "raw-input",
      projectPath: projectDir,
      transcriptPath,
      timestamp: "2026-08-01T00:00:01Z",
      payload: { conversationId: "metadata-only" }
    })}\n`,
    "utf8"
  );

  const result = processCandidates({ project, scope: "local", home });
  const memories = new MemoryRepository(project, { home });
  expect(result.created).toBe(1);
  expect(memories.listCandidates()[0]?.content).toContain("quyết định dùng SQLite");
  memories.close();
});

test("processing the same capture twice is idempotent", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-test-"));
  const projectDir = mkdtempSync(join(tmpdir(), "smem-project-"));
  tempDirs.push(home, projectDir);
  const registry = new RegistryRepository(home);
  const project = registry.initProject({ cwd: projectDir, name: "demo" });
  registry.close();
  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    `${JSON.stringify({ eventId: "evt_idempotent", agent: "antigravity", event: "PreInvocation", projectPath: projectDir, signal: "high", payload: { prompt: "quyết định dùng SQLite" } })}\n`,
    "utf8"
  );

  const first = processCandidates({ project, scope: "local", home });
  const second = processCandidates({ project, scope: "local", home });
  expect(first.created).toBe(1);
  expect(second.created).toBe(0);
  expect(second.skippedByReason.duplicate).toBe(1);
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

  expect(result).toEqual({ scanned: 1, created: 0, skipped: 1, skippedByReason: { "no-text": 1, "low-confidence": 0, "wrong-project": 0, "unsupported-label": 0, duplicate: 0 } });
});
