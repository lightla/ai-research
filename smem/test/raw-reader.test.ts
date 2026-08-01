import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  findRawEventById,
  findTranscriptRecordById,
  formatRawEventFull,
  rawThread,
  searchRawEvents,
  summarizeRawEvent,
  summarizeTranscriptRecord,
  transcriptRecordId
} from "../src/raw/raw-reader";

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
  expect(summarizeRawEvent(record!, "stest-k001")).toContain("id=evt_test");
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

test("finds raw events and normalized transcript records by stable id", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-raw-"));
  tempDirs.push(home);
  const transcriptPath = join(home, "transcript_full.jsonl");
  mkdirSync(join(home, "events"), { recursive: true });
  const events = [
    { source: "USER_EXPLICIT", type: "USER_INPUT", created_at: "2026-08-01T00:00:00Z", content: "input" },
    { source: "MODEL", type: "PLANNER_RESPONSE", created_at: "2026-08-01T00:00:01Z", content: "output" }
  ];
  writeFileSync(transcriptPath, events.map((event) => JSON.stringify(event)).join("\n"), "utf8");
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    `${JSON.stringify({ eventId: "evt_test", agent: "antigravity", transcriptPath })}\n`,
    "utf8"
  );

  const transcriptRecord = { transcriptPath, lineNumber: 2, event: events[1]! };
  expect(findRawEventById("evt_test", home)?.event["eventId"]).toBe("evt_test");
  expect(findTranscriptRecordById(transcriptRecordId(transcriptRecord), home)?.lineNumber).toBe(2);
});

test.each([
  ["claude-code", "claude-code/session.jsonl", "Claude Code"],
  ["codex", "codex/session.jsonl", "Codex"]
])("normalizes %s transcript fixture messages", (agent, fixture, label) => {
  const home = mkdtempSync(join(tmpdir(), "smem-adapter-"));
  tempDirs.push(home);
  const transcriptPath = join(home, fixture);
  mkdirSync(join(home, fixture, ".."), { recursive: true });
  const fixturePath = join(process.cwd(), "test", "fixtures", fixture);
  writeFileSync(transcriptPath, readFileSync(fixturePath), "utf8");
  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    `${JSON.stringify({ eventId: "evt_fixture", agent, transcriptPath })}\n`,
    "utf8"
  );

  const result = rawThread({ home, query: "Remember", after: 1 });
  expect(result.records).toHaveLength(2);
  const first = summarizeTranscriptRecord(result.records[0]!);
  const second = summarizeTranscriptRecord(result.records[1]!);
  expect(first).toContain(`agent=${agent}`);
  expect(first).toContain("role=user");
  expect(first).toContain("Remember");
  expect(second).toContain("role=assistant");
  expect(second).toContain(label === "Codex" ? "SQLite" : "outside");
});
