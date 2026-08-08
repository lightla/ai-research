import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  deleteRawEventById,
  deleteTranscriptRecordById,
  findRawEventById,
  findTranscriptRecordById,
  formatRawEventFull,
  isMeaningfulHistoryRecord,
  normalizeTranscriptRecord,
  rawThread,
  searchRawEvents,
  searchReferencedTranscripts,
  summarizeRawEvent,
  summarizeTranscriptRecord,
  transcriptRecordId,
  updateTranscriptRecordContent
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

test("--after counts meaningful records, skipping thinking/tool-call noise in between", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-raw-"));
  tempDirs.push(home);
  const transcriptPath = join(home, "antigravity-cli", "transcript_full.jsonl");
  mkdirSync(join(home, "antigravity-cli"), { recursive: true });
  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    `${JSON.stringify({ eventId: "evt_test", agent: "antigravity", transcriptPath })}\n`,
    "utf8"
  );

  writeFileSync(
    transcriptPath,
    [
      { source: "USER_EXPLICIT", type: "USER_INPUT", created_at: "2026-08-01T00:00:00Z", content: "input stest-k001" },
      { type: "RUN_COMMAND", created_at: "2026-08-01T00:00:01Z", content: "ls" },
      { source: "MODEL", type: "PLANNER_RESPONSE", created_at: "2026-08-01T00:00:02Z", thinking: "considering next step" },
      { type: "RUN_COMMAND", created_at: "2026-08-01T00:00:03Z", content: "grep" },
      { source: "MODEL", type: "PLANNER_RESPONSE", created_at: "2026-08-01T00:00:04Z", content: "output stest-a888" }
    ].map((event) => JSON.stringify(event)).join("\n"),
    "utf8"
  );

  const shallow = rawThread({ home, query: "stest-k001", after: 1 });
  expect(shallow.records.filter(isMeaningfulHistoryRecord)).toHaveLength(2);
  expect(shallow.records.at(-1)?.event["content"]).toBe("output stest-a888");

  const anchorOnly = rawThread({ home, query: "stest-k001", after: 0 });
  expect(anchorOnly.records).toHaveLength(1);
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

test("deletes a raw event by id without touching other lines", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-raw-"));
  tempDirs.push(home);
  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    [
      { eventId: "evt_keep_1", agent: "antigravity", event: "PostToolUse" },
      { eventId: "evt_target", agent: "antigravity", event: "PostToolUse" },
      { eventId: "evt_keep_2", agent: "antigravity", event: "PostToolUse" }
    ].map((event) => JSON.stringify(event)).join("\n") + "\n",
    "utf8"
  );

  expect(findRawEventById("evt_target", home)).not.toBeNull();
  expect(deleteRawEventById("evt_target", home)).toBe(true);
  expect(findRawEventById("evt_target", home)).toBeNull();
  expect(findRawEventById("evt_keep_1", home)?.event["eventId"]).toBe("evt_keep_1");
  expect(findRawEventById("evt_keep_2", home)?.event["eventId"]).toBe("evt_keep_2");
  expect(deleteRawEventById("evt_target", home)).toBe(false);
});

test("deletes a transcript record by id without touching other lines", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-raw-"));
  tempDirs.push(home);
  const transcriptPath = join(home, "transcript_full.jsonl");
  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    `${JSON.stringify({ eventId: "evt_test", agent: "antigravity", transcriptPath })}\n`,
    "utf8"
  );
  writeFileSync(
    transcriptPath,
    [
      { source: "USER_EXPLICIT", type: "USER_INPUT", created_at: "2026-08-01T00:00:00Z", content: "keep me" },
      { source: "MODEL", type: "PLANNER_RESPONSE", created_at: "2026-08-01T00:00:01Z", content: "delete me stest-x1" },
      { source: "USER_EXPLICIT", type: "USER_INPUT", created_at: "2026-08-01T00:00:02Z", content: "keep me too" }
    ].map((event) => JSON.stringify(event)).join("\n"),
    "utf8"
  );

  const [target] = searchReferencedTranscripts({ home, query: "stest-x1" });
  const targetId = transcriptRecordId(target!);
  expect(deleteTranscriptRecordById(targetId, home)).toBe(true);
  expect(findTranscriptRecordById(targetId, home)).toBeNull();
  expect(searchReferencedTranscripts({ home, query: "keep me" })).toHaveLength(2);
  expect(deleteTranscriptRecordById(targetId, home)).toBe(false);
});

test("scopes raw search to a project path when provided", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-raw-"));
  tempDirs.push(home);
  const transcriptA = join(home, "a.jsonl");
  const transcriptB = join(home, "b.jsonl");
  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    [
      { eventId: "evt_a", agent: "antigravity", projectPath: "/proj/a", transcriptPath: transcriptA },
      { eventId: "evt_b", agent: "antigravity", projectPath: "/proj/b", transcriptPath: transcriptB }
    ].map((event) => JSON.stringify(event)).join("\n") + "\n",
    "utf8"
  );
  writeFileSync(transcriptA, JSON.stringify({ type: "USER_INPUT", content: "shared-term in project a" }), "utf8");
  writeFileSync(transcriptB, JSON.stringify({ type: "USER_INPUT", content: "shared-term in project b" }), "utf8");

  const events = searchRawEvents({ home, query: "", projectPath: "/proj/a" });
  expect(events).toHaveLength(1);
  expect(events[0]?.event["eventId"]).toBe("evt_a");

  const transcripts = searchReferencedTranscripts({ home, query: "shared-term", projectPath: "/proj/a" });
  expect(transcripts).toHaveLength(1);
  expect(transcripts[0]?.transcriptPath).toBe(transcriptA);
});

test("lists all transcript records newest-first with pagination when query is empty", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-raw-"));
  tempDirs.push(home);
  const transcriptPath = join(home, "transcript_full.jsonl");
  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    `${JSON.stringify({ eventId: "evt_test", agent: "antigravity", transcriptPath })}\n`,
    "utf8"
  );
  writeFileSync(
    transcriptPath,
    [
      { type: "USER_INPUT", created_at: "2026-08-01T00:00:00Z", content: "first" },
      { type: "USER_INPUT", created_at: "2026-08-01T00:00:01Z", content: "second" },
      { type: "USER_INPUT", created_at: "2026-08-01T00:00:02Z", content: "third" }
    ].map((event) => JSON.stringify(event)).join("\n"),
    "utf8"
  );

  const page1 = searchReferencedTranscripts({ home, query: "", limit: 2, offset: 0 });
  expect(page1.map((r) => r.event["content"])).toEqual(["third", "second"]);

  const page2 = searchReferencedTranscripts({ home, query: "", limit: 2, offset: 2 });
  expect(page2.map((r) => r.event["content"])).toEqual(["first"]);
});

test("lists all raw events newest-first with pagination when query is empty", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-raw-"));
  tempDirs.push(home);
  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    [
      { eventId: "evt_1", agent: "antigravity" },
      { eventId: "evt_2", agent: "antigravity" },
      { eventId: "evt_3", agent: "antigravity" }
    ].map((event) => JSON.stringify(event)).join("\n") + "\n",
    "utf8"
  );

  const page1 = searchRawEvents({ home, query: "", limit: 2, offset: 0 });
  expect(page1.map((r) => r.event["eventId"])).toEqual(["evt_3", "evt_2"]);

  const page2 = searchRawEvents({ home, query: "", limit: 2, offset: 2 });
  expect(page2.map((r) => r.event["eventId"])).toEqual(["evt_1"]);
});

test("updates a top-level content field in place by record id", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-raw-"));
  tempDirs.push(home);
  const transcriptPath = join(home, "transcript_full.jsonl");
  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    `${JSON.stringify({ eventId: "evt_test", agent: "antigravity", transcriptPath })}\n`,
    "utf8"
  );
  writeFileSync(
    transcriptPath,
    [
      { source: "USER_EXPLICIT", type: "USER_INPUT", created_at: "2026-08-01T00:00:00Z", content: "keep me" },
      { source: "MODEL", type: "PLANNER_RESPONSE", created_at: "2026-08-01T00:00:01Z", content: "old content" }
    ].map((event) => JSON.stringify(event)).join("\n"),
    "utf8"
  );

  const [target] = searchReferencedTranscripts({ home, query: "old content" });
  const targetId = transcriptRecordId(target!);

  const newId = updateTranscriptRecordContent(targetId, "new content", home);
  expect(newId).not.toBeNull();
  expect(newId).not.toBe(targetId);

  // The old id is gone (content changed, so its hash changed); the new id resolves the edit.
  expect(findTranscriptRecordById(targetId, home)).toBeNull();
  const updated = findTranscriptRecordById(newId!, home);
  expect(normalizeTranscriptRecord(updated!).content).toBe("new content");

  // The other line is untouched.
  const untouched = searchReferencedTranscripts({ home, query: "keep me" });
  expect(untouched).toHaveLength(1);
});

test("updates a nested message.content text block in place by record id", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-raw-"));
  tempDirs.push(home);
  const transcriptPath = join(home, "claude-code", "session.jsonl");
  mkdirSync(join(home, "claude-code"), { recursive: true });
  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(
    join(home, "events", "pending.jsonl"),
    `${JSON.stringify({ eventId: "evt_test", agent: "claude-code", transcriptPath })}\n`,
    "utf8"
  );
  writeFileSync(
    transcriptPath,
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "old nested content" }] },
      timestamp: "2026-08-02T00:00:00Z"
    }),
    "utf8"
  );

  const [target] = searchReferencedTranscripts({ home, query: "old nested content" });
  const targetId = transcriptRecordId(target!);

  const newId = updateTranscriptRecordContent(targetId, "new nested content", home);
  expect(newId).not.toBeNull();
  const updated = findTranscriptRecordById(newId!, home);
  expect(normalizeTranscriptRecord(updated!).content).toBe("new nested content");
});

test("returns null when updating an unknown record id", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-raw-"));
  tempDirs.push(home);
  expect(updateTranscriptRecordContent("does-not-exist", "x", home)).toBeNull();
});

test("rawThread supports before options, count tracking, and ID query matching", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-raw-"));
  tempDirs.push(home);
  const transcriptPath = join(home, "transcript_before_after.jsonl");
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
  
  const events = [
    { source: "USER_EXPLICIT", type: "USER_INPUT", created_at: "2026-08-01T00:00:00Z", content: "msg1 first" },
    { source: "MODEL", type: "PLANNER_RESPONSE", created_at: "2026-08-01T00:00:01Z", content: "msg2 second" },
    { source: "USER_EXPLICIT", type: "USER_INPUT", created_at: "2026-08-01T00:00:02Z", content: "msg3 third target-keyword" },
    { source: "MODEL", type: "PLANNER_RESPONSE", created_at: "2026-08-01T00:00:03Z", content: "msg4 fourth" },
    { source: "USER_EXPLICIT", type: "USER_INPUT", created_at: "2026-08-01T00:00:04Z", content: "msg5 fifth" }
  ];

  writeFileSync(
    transcriptPath,
    events.map((event) => JSON.stringify(event)).join("\n"),
    "utf8"
  );

  // Test keyword search with before and after options
  const threadRes = rawThread({ home, query: "target-keyword", before: 2, after: 2 });
  expect(threadRes.totalMatches).toBe(1);
  expect(threadRes.anchor?.event["content"]).toContain("target-keyword");
  
  // Records should have before records, anchor, and after records
  // We asked for before: 2 (msg1, msg2), anchor (msg3), after: 2 (msg4, msg5)
  expect(threadRes.records).toHaveLength(5);
  expect(threadRes.records[0]?.event["content"]).toBe("msg1 first");
  expect(threadRes.records[1]?.event["content"]).toBe("msg2 second");
  expect(threadRes.records[2]?.event["content"]).toContain("target-keyword");
  expect(threadRes.records[3]?.event["content"]).toBe("msg4 fourth");
  expect(threadRes.records[4]?.event["content"]).toBe("msg5 fifth");

  // Test ID search
  const anchorRecord = threadRes.anchor!;
  const recordIdStr = transcriptRecordId(anchorRecord);
  
  // Search using the record ID directly
  const idThreadRes = rawThread({ home, query: recordIdStr, before: 1, after: 1 });
  expect(idThreadRes.totalMatches).toBe(1);
  expect(idThreadRes.anchor).not.toBeNull();
  expect(idThreadRes.anchor?.event["content"]).toContain("target-keyword");
  expect(idThreadRes.records).toHaveLength(3);
  expect(idThreadRes.records[0]?.event["content"]).toBe("msg2 second");
  expect(idThreadRes.records[1]?.event["content"]).toContain("target-keyword");
  expect(idThreadRes.records[2]?.event["content"]).toBe("msg4 fourth");
});
