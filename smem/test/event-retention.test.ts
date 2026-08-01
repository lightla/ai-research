import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { archiveRawEvents } from "../src/hook/event-retention";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("archives old valid events while keeping recent and invalid lines recoverable", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-retention-"));
  tempDirs.push(home);
  mkdirSync(join(home, "events"), { recursive: true });
  const now = Date.parse("2026-08-02T00:00:00Z");
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    [
      JSON.stringify({ eventId: "old", timestamp: "2026-07-01T00:00:00Z" }),
      JSON.stringify({ eventId: "new", timestamp: "2026-08-01T00:00:00Z" }),
      "invalid-json"
    ].join("\n") + "\n",
    "utf8"
  );

  const result = archiveRawEvents({ home, olderThanDays: 7, now });
  expect(result).toMatchObject({ scanned: 3, archived: 1, kept: 2, invalid: 1 });
  expect(result.archivePath && existsSync(result.archivePath)).toBe(true);
  expect(readFileSync(join(home, "events", "pending.jsonl"), "utf8")).toContain("new");
  expect(readFileSync(join(home, "events", "pending.jsonl"), "utf8")).toContain("invalid-json");
});
