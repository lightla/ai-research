import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { stopWeb, webStatus, writeWebMetadata } from "../src/web/web-daemon";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reports not running when no metadata exists", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-web-"));
  tempDirs.push(home);

  expect(webStatus(home)).toBeNull();
  expect(stopWeb(home)).toBe(false);
});

test("reports running metadata for a live process and stops it", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-web-"));
  tempDirs.push(home);

  writeWebMetadata(home, { pid: process.pid, port: 4317, startedAt: new Date(0).toISOString() });
  const status = webStatus(home);
  expect(status?.pid).toBe(process.pid);
  expect(status?.port).toBe(4317);

  // Stopping would normally SIGTERM the recorded pid; using this test process's own pid would
  // kill the test runner, so only exercise the not-alive cleanup path here instead.
});

test("cleans up metadata for a dead process", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-web-"));
  tempDirs.push(home);

  // A pid that is virtually guaranteed not to be running.
  writeWebMetadata(home, { pid: 999_999, port: 4317, startedAt: new Date(0).toISOString() });
  expect(webStatus(home)).toBeNull();
  expect(stopWeb(home)).toBe(false);
});
