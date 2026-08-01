import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { daemonStatus, processOnce, stopDaemon } from "../src/daemon/daemon";
import { RegistryRepository } from "../src/storage/registry-repository";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("daemon once processes an empty project and status is recoverable", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-daemon-"));
  const projectDir = mkdtempSync(join(tmpdir(), "smem-daemon-project-"));
  tempDirs.push(home, projectDir);
  const registry = new RegistryRepository(home);
  registry.initProject({ cwd: projectDir, name: "daemon-test" });
  registry.close();

  expect(processOnce({ cwd: projectDir, scope: "local", home })).toEqual({
    scanned: 0,
    created: 0,
    skipped: 0,
    skippedByReason: { "no-text": 0, "low-confidence": 0, "wrong-project": 0, "unsupported-label": 0, duplicate: 0 }
  });
  expect(daemonStatus(home)).toBeNull();
  expect(stopDaemon(home)).toBe(false);
});
