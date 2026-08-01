import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { formatRawEventFull, rawThread, searchRawEvents, summarizeRawEvent } from "../src/raw/raw-reader";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("searches raw hook captures without requiring active memories", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-raw-"));
  tempDirs.push(home);
  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    `${JSON.stringify({
      eventId: "evt_test",
      agent: "antigravity",
      event: "PostToolUse",
      captureKind: "tool-event",
      timestamp: "2026-08-01T00:00:00.000Z",
      signal: "low",
      classification: { primaryLabel: "note" },
      payload: {
        toolCall: {
          args: {
            CommandLine: "grep stest-k001 pending.jsonl"
          }
        }
      }
    })}\n`,
    "utf8"
  );

  const [record] = searchRawEvents({ home, query: "stest-k001", kind: "tool-event" });

  expect(record?.lineNumber).toBe(1);
  expect(summarizeRawEvent(record!, "stest-k001")).toContain("payload.toolCall.args.CommandLine");
  expect(summarizeRawEvent(record!, "stest-k001")).toContain("stest-k001");
  expect(formatRawEventFull(record!)).toContain('"eventId": "evt_test"');
});

test("prints transcript history from the best raw match onward", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-raw-"));
  tempDirs.push(home);
  const transcriptPath = join(home, "transcript_full.jsonl");
  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    `${JSON.stringify({
      eventId: "evt_test",
      agent: "antigravity",
      event: "PostInvocation",
      captureKind: "raw-output",
      transcriptPath,
      payload: { transcriptPath }
    })}\n`,
    "utf8"
  );
  writeFileSync(
    transcriptPath,
    [
      { source: "USER_EXPLICIT", type: "USER_INPUT", created_at: "2026-08-01T00:00:00Z", content: "<USER_REQUEST>\ninput stest-k001\n</USER_REQUEST>" },
      { source: "MODEL", type: "PLANNER_RESPONSE", created_at: "2026-08-01T00:00:01Z", content: "output stest-a888" }
    ].map((event) => JSON.stringify(event)).join("\n"),
    "utf8"
  );

  const result = rawThread({ home, query: "stest-k001", after: 1 });

  expect(result.records).toHaveLength(2);
  expect(result.records[0]?.event["type"]).toBe("USER_INPUT");
  expect(result.records[1]?.event["content"]).toBe("output stest-a888");
});
