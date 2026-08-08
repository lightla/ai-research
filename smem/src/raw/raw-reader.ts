import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { base58FromBytes } from "../core/ids";
import { defaultSmartMemoryHome } from "../core/paths";

export type RawEventRecord = {
  lineNumber: number;
  line: string;
  event: Record<string, unknown>;
};

export type TranscriptRecord = {
  transcriptPath: string;
  lineNumber: number;
  event: Record<string, unknown>;
};

export type SmemHistoryRecord = {
  id: string;
  fromSource: "antigravity-transcript" | "claude-code-transcript" | "codex-transcript" | "unknown-transcript";
  sourceAgent: "antigravity" | "claude-code" | "codex" | "unknown";
  sourcePath: string;
  sourceLine: number;
  timestamp?: string;
  role: "user" | "assistant" | "tool" | "system" | "unknown";
  recordKind: "user-input" | "assistant-output" | "assistant-thinking" | "tool-call" | "tool-result" | "metadata" | "unknown";
  content?: string;
  type?: string;
  namespace?: string | null;
  title?: string | null;
  tags?: string[];
  raw: Record<string, unknown>;
};

export type RawSearchResult = {
  events: RawEventRecord[];
  transcripts: TranscriptRecord[];
  totalEvents: number;
  totalTranscripts: number;
};

export type RawThreadResult = {
  anchor: TranscriptRecord | null;
  records: TranscriptRecord[];
  totalMatches?: number;
};

export interface RawEventRecordsArray extends Array<RawEventRecord> {
  totalCount?: number;
}

export interface TranscriptRecordsArray extends Array<TranscriptRecord> {
  totalCount?: number;
}

export function searchRaw(options: {
  query: string;
  home?: string;
  limit?: number;
  offset?: number;
  agent?: string;
  kind?: string;
  projectPath?: string;
}): RawSearchResult {
  const events = searchRawEvents(options);
  const transcripts = searchReferencedTranscripts(options);
  return {
    events,
    transcripts,
    totalEvents: (events as RawEventRecordsArray).totalCount ?? events.length,
    totalTranscripts: (transcripts as TranscriptRecordsArray).totalCount ?? transcripts.length
  };
}

export function searchRawEvents(options: {
  query: string;
  home?: string;
  limit?: number;
  offset?: number;
  agent?: string;
  kind?: string;
  projectPath?: string;
}): RawEventRecord[] {
  const queuePath = join(options.home ?? defaultSmartMemoryHome(), "events", "pending.jsonl");
  if (!existsSync(queuePath)) {
    const emptyResult: RawEventRecordsArray = [];
    emptyResult.totalCount = 0;
    return emptyResult;
  }

  const query = options.query.trim().toLowerCase();
  const matches: RawEventRecord[] = [];
  const lines = readFileSync(queuePath, "utf8").split(/\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    if (query && !line.toLowerCase().includes(query)) {
      continue;
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (options.agent && event["agent"] !== options.agent) {
      continue;
    }
    if (options.kind && event["captureKind"] !== options.kind) {
      continue;
    }
    if (options.projectPath && event["projectPath"] !== options.projectPath) {
      continue;
    }

    matches.push({
      lineNumber: index + 1,
      line,
      event
    });
  }

  // `matches` accumulates oldest-first (file order); reverse for newest-first paging.
  const newestFirst = matches.slice().reverse();
  const offset = options.offset ?? 0;
  const records = newestFirst.slice(offset, offset + (options.limit ?? 20)) as RawEventRecordsArray;
  records.totalCount = matches.length;
  return records;
}

export function findRawEventById(eventId: string, home = defaultSmartMemoryHome()): RawEventRecord | null {
  const queuePath = join(home, "events", "pending.jsonl");
  if (!existsSync(queuePath)) {
    return null;
  }

  const lines = readFileSync(queuePath, "utf8").split(/\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }

    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (stringField(event, "eventId") === eventId) {
        return { lineNumber: index + 1, line, event };
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function searchReferencedTranscripts(options: {
  query: string;
  home?: string;
  limit?: number;
  offset?: number;
  agent?: string;
  kind?: string;
  projectPath?: string;
}): TranscriptRecord[] {
  const query = options.query.trim().toLowerCase();

  const transcriptPaths = transcriptPathsFromRawEvents(options);
  const matches: TranscriptRecord[] = [];

  for (const transcriptPath of transcriptPaths) {
    if (!existsSync(transcriptPath)) {
      continue;
    }

    const lines = readFileSync(transcriptPath, "utf8").split(/\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim();
      if (!line) {
        continue;
      }
      // An empty query means "list everything" (used to browse history without typing),
      // so only apply the substring filter when the caller actually typed something.
      if (query && !line.toLowerCase().includes(query)) {
        continue;
      }

      try {
        matches.push({
          transcriptPath,
          lineNumber: index + 1,
          event: JSON.parse(line) as Record<string, unknown>
        });
      } catch {
        continue;
      }
    }
  }

  const sorted = query
    ? matches.sort((left, right) => transcriptRank(right, query) - transcriptRank(left, query))
    : matches.sort((left, right) => recencyKey(right) - recencyKey(left));

  const offset = options.offset ?? 0;
  const records = sorted.slice(offset, offset + (options.limit ?? 20)) as TranscriptRecordsArray;
  records.totalCount = matches.length;
  return records;
}

function recencyKey(record: TranscriptRecord): number {
  const timestamp = normalizeTranscriptRecord(record).timestamp;
  const parsed = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function rawThread(options: {
  query: string;
  home?: string;
  before?: number;
  after?: number;
  agent?: string;
  kind?: string;
  offset?: number;
}): RawThreadResult {
  const query = options.query.trim();
  let anchor: TranscriptRecord | null = null;
  let totalMatches = 0;

  if (query && !query.includes(" ") && query.length >= 10) {
    anchor = findTranscriptRecordById(query, options.home);
    if (anchor) {
      totalMatches = 1;
    }
  }

  if (!anchor) {
    const matches = searchReferencedTranscripts({
      query: options.query,
      limit: 1,
      ...(options.offset !== undefined ? { offset: options.offset } : {}),
      ...(options.home ? { home: options.home } : {}),
      ...(options.agent ? { agent: options.agent } : {}),
      ...(options.kind ? { kind: options.kind } : {})
    });
    anchor = matches[0] || null;
    totalMatches = (matches as TranscriptRecordsArray).totalCount ?? (anchor ? 1 : 0);
  }

  if (!anchor || !existsSync(anchor.transcriptPath)) {
    return { anchor: null, records: [], totalMatches: 0 };
  }

  const before = options.before ?? 0;
  const after = options.after ?? 10;
  const lines = readFileSync(anchor.transcriptPath, "utf8").split(/\n/);

  // Get before records (scanned backward from anchor)
  const beforeRecords: TranscriptRecord[] = [];
  let meaningfulBefore = 0;
  for (let lineNumber = anchor.lineNumber - 1; lineNumber >= 1; lineNumber -= 1) {
    const line = lines[lineNumber - 1]?.trim();
    if (!line) {
      continue;
    }

    let record: TranscriptRecord;
    try {
      record = {
        transcriptPath: anchor.transcriptPath,
        lineNumber,
        event: JSON.parse(line) as Record<string, unknown>
      };
    } catch {
      continue;
    }

    beforeRecords.push(record);

    if (isMeaningfulHistoryRecord(record)) {
      meaningfulBefore += 1;
      if (meaningfulBefore >= before) {
        break;
      }
    }
  }
  beforeRecords.reverse();

  // Get anchor and after records (scanned forward from anchor)
  const afterRecords: TranscriptRecord[] = [];
  let meaningfulAfter = 0;
  for (let lineNumber = anchor.lineNumber; lineNumber <= lines.length; lineNumber += 1) {
    const line = lines[lineNumber - 1]?.trim();
    if (!line) {
      continue;
    }

    let record: TranscriptRecord;
    try {
      record = {
        transcriptPath: anchor.transcriptPath,
        lineNumber,
        event: JSON.parse(line) as Record<string, unknown>
      };
    } catch {
      continue;
    }

    afterRecords.push(record);

    if (lineNumber === anchor.lineNumber) {
      if (after <= 0) {
        break;
      }
      continue;
    }

    if (isMeaningfulHistoryRecord(record)) {
      meaningfulAfter += 1;
      if (meaningfulAfter >= after) {
        break;
      }
    }
  }

  const records = [...beforeRecords, ...afterRecords];
  return { anchor, records, totalMatches };
}

export function findTranscriptRecordById(recordId: string, home = defaultSmartMemoryHome()): TranscriptRecord | null {
  for (const transcriptPath of transcriptPathsFromRawEvents({ home })) {
    if (!existsSync(transcriptPath)) {
      continue;
    }

    const lines = readFileSync(transcriptPath, "utf8").split(/\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim();
      if (!line) {
        continue;
      }

      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        const record = { transcriptPath, lineNumber: index + 1, event };
        if (transcriptRecordId(record) === recordId) {
          return record;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

// Rewrites a transcript record's content in place, keyed by its stable id — independent of
// whether the edit is ever promoted into an official memory. Different agents nest their text in
// different shapes (a top-level `content` string for antigravity, `message.content`/`payload.content`
// arrays of text blocks for claude-code/codex), so this mirrors normalizeTranscriptRecord's
// extraction path in reverse rather than assuming one fixed shape.
//
// Record ids are a hash of (path, line number, event JSON) — see transcriptRecordId — so editing
// content necessarily changes the id. Returns the NEW id (or null if the record wasn't found) so
// callers can keep tracking the edited record instead of looking it up by its now-stale old id.
export function updateTranscriptRecordContent(
  recordId: string,
  newContent: string,
  home = defaultSmartMemoryHome(),
  extra?: { type?: string; namespace?: string | null; title?: string | null; tags?: string[] }
): string | null {
  const record = findTranscriptRecordById(recordId, home);
  if (!record) {
    return null;
  }

  const updatedEvent = withUpdatedContent(record.event, newContent);
  if (!updatedEvent) {
    throw new Error("This record's raw format doesn't support in-place content editing.");
  }

  if (extra && updatedEvent) {
    if (extra.type !== undefined) updatedEvent.type = extra.type;
    if (extra.namespace !== undefined) updatedEvent.namespace = extra.namespace;
    if (extra.title !== undefined) updatedEvent.title = extra.title;
    if (extra.tags !== undefined) updatedEvent.tags = extra.tags;
  }

  const lines = readFileSync(record.transcriptPath, "utf8").split(/\n/);
  const targetIndex = record.lineNumber - 1;
  if (targetIndex < 0 || targetIndex >= lines.length) {
    return null;
  }

  lines[targetIndex] = JSON.stringify(updatedEvent);
  writeFileSync(record.transcriptPath, lines.join("\n"), "utf8");
  return transcriptRecordId({ transcriptPath: record.transcriptPath, lineNumber: record.lineNumber, event: updatedEvent });
}

function withUpdatedContent(event: Record<string, unknown>, newContent: string): Record<string, unknown> | null {
  if (typeof event["content"] === "string") {
    return { ...event, content: newContent };
  }

  const contentArray = event["content"];
  if (Array.isArray(contentArray)) {
    let updated = false;
    const newArray = contentArray.map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const textKey = (["text", "input_text", "output_text"] as const).find(
          (key) => typeof (item as Record<string, unknown>)[key] === "string"
        );
        if (textKey && !updated) {
          updated = true;
          return { ...(item as Record<string, unknown>), [textKey]: newContent };
        }
      }
      return item;
    });
    if (updated) {
      return { ...event, content: newArray };
    }
  }

  for (const key of ["message", "payload"]) {
    const nested = event[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const updatedNested = withUpdatedContent(nested as Record<string, unknown>, newContent);
      if (updatedNested) {
        return { ...event, [key]: updatedNested };
      }
    }
  }

  if (typeof event["thinking"] === "string" && !event["content"]) {
    return { ...event, thinking: newContent };
  }

  return null;
}

export function deleteRawEventById(eventId: string, home = defaultSmartMemoryHome()): boolean {
  const queuePath = join(home, "events", "pending.jsonl");
  if (!existsSync(queuePath)) {
    return false;
  }

  const lines = readFileSync(queuePath, "utf8").split(/\n/);
  const kept: string[] = [];
  let removed = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (!removed) {
      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        if (stringField(event, "eventId") === eventId) {
          removed = true;
          continue;
        }
      } catch {
        // Keep unparsable lines untouched.
      }
    }
    kept.push(trimmed);
  }

  if (!removed) {
    return false;
  }

  writeFileSync(queuePath, kept.length > 0 ? `${kept.join("\n")}\n` : "", "utf8");
  return true;
}

// Transcript record ids are a hash of (path, line number, event JSON), so deleting a line shifts
// every later record's id — that's fine since ids are always recomputed from current file content
// on demand, never persisted elsewhere.
export function deleteTranscriptRecordById(recordId: string, home = defaultSmartMemoryHome()): boolean {
  const record = findTranscriptRecordById(recordId, home);
  if (!record) {
    return false;
  }

  const lines = readFileSync(record.transcriptPath, "utf8").split(/\n/);
  const targetIndex = record.lineNumber - 1;
  if (targetIndex < 0 || targetIndex >= lines.length) {
    return false;
  }

  lines.splice(targetIndex, 1);
  writeFileSync(record.transcriptPath, lines.join("\n"), "utf8");
  return true;
}

export function transcriptTextForCapture(options: {
  transcriptPath?: string;
  captureKind: string;
  timestamp?: string;
}): string | undefined {
  if (!options.transcriptPath || !existsSync(options.transcriptPath)) {
    return undefined;
  }

  const wantedKind = options.captureKind === "raw-input" ? "user-input" : options.captureKind === "raw-output" ? "assistant-output" : undefined;
  if (!wantedKind) {
    return undefined;
  }

  const candidates: SmemHistoryRecord[] = [];
  const lines = readFileSync(options.transcriptPath, "utf8").split(/\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    try {
      const record = normalizeTranscriptRecord({
        transcriptPath: options.transcriptPath,
        lineNumber: index + 1,
        event: JSON.parse(line) as Record<string, unknown>
      });
      if (record.recordKind === wantedKind && record.content?.trim()) {
        candidates.push(record);
      }
    } catch {
      continue;
    }
  }

  const eligible = options.timestamp
    ? candidates.filter((record) => !record.timestamp || record.timestamp <= options.timestamp!)
    : candidates;
  return (eligible.at(-1) ?? candidates.at(-1))?.content;
}

export function summarizeRawEvent(record: RawEventRecord, query?: string): string {
  const event = record.event;
  const classification = recordField(event, "classification");
  const payload = recordField(event, "payload") ?? {};
  const parts = [
    `id=${stringField(event, "eventId") ?? `raw#${record.lineNumber}`}`,
    `raw#${record.lineNumber}`,
    stringField(event, "timestamp"),
    `agent=${stringField(event, "agent") ?? "unknown"}`,
    `event=${stringField(event, "event") ?? "unknown"}`,
    `kind=${stringField(event, "captureKind") ?? "legacy"}`,
    `signal=${stringField(event, "signal") ?? "unknown"}`,
    `label=${stringField(classification, "primaryLabel") ?? "unknown"}`
  ].filter(Boolean);

  const matched = query ? matchedTextFields(event, query).slice(0, 6) : [];
  const details = matched.length > 0
    ? matched.map((field) => `${field.path}: ${field.value}`).join("\n")
    : previewText(payload) ?? record.line;
  return `${parts.join(" ")}\n${details}`;
}

export function formatRawEventFull(record: RawEventRecord): string {
  return `raw#${record.lineNumber}\n${JSON.stringify(record.event, null, 2)}`;
}

export function summarizeTranscriptRecord(record: TranscriptRecord, query?: string): string {
  const normalized = normalizeTranscriptRecord(record);
  const parts = [
    `id=${normalized.id}`,
    `transcript#${record.lineNumber}`,
    normalized.timestamp,
    `fromSource=${normalized.fromSource}`,
    `agent=${normalized.sourceAgent}`,
    `role=${normalized.role}`,
    `kind=${normalized.recordKind}`
  ].filter(Boolean);

  const details = readableTranscriptDetails(normalized, query);
  return `${parts.join(" ")}\n${details}`;
}

export function formatTranscriptRecordFull(record: TranscriptRecord): string {
  return `id=${transcriptRecordId(record)} transcript#${record.lineNumber} path=${record.transcriptPath}\n${JSON.stringify(record.event, null, 2)}`;
}

export function isMeaningfulHistoryRecord(record: TranscriptRecord): boolean {
  const normalized = normalizeTranscriptRecord(record);
  return (
    (normalized.recordKind === "user-input" || normalized.recordKind === "assistant-output") &&
    Boolean(normalized.content?.trim())
  );
}

export function transcriptRecordId(record: TranscriptRecord): string {
  const hash = createHash("sha256")
    .update(record.transcriptPath)
    .update("\0")
    .update(String(record.lineNumber))
    .update("\0")
    .update(JSON.stringify(record.event))
    .digest()
    .subarray(0, 16);
  return base58FromBytes(hash);
}

function transcriptPathsFromRawEvents(options: {
  home?: string;
  agent?: string;
  kind?: string;
  projectPath?: string;
}): string[] {
  const queuePath = join(options.home ?? defaultSmartMemoryHome(), "events", "pending.jsonl");
  if (!existsSync(queuePath)) {
    return [];
  }

  const paths = new Set<string>();
  for (const line of readFileSync(queuePath, "utf8").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      if (options.agent && event["agent"] !== options.agent) {
        continue;
      }
      if (options.kind && event["captureKind"] !== options.kind) {
        continue;
      }
      if (options.projectPath && event["projectPath"] !== options.projectPath) {
        continue;
      }
      const transcriptPath = stringField(event, "transcriptPath") ?? stringField(recordField(event, "payload"), "transcriptPath");
      if (transcriptPath) {
        paths.add(transcriptPath);
      }
    } catch {
      continue;
    }
  }

  return [...paths];
}

function transcriptRank(record: TranscriptRecord, query: string): number {
  const normalized = normalizeTranscriptRecord(record);
  const content = normalized.content ?? "";
  let score = record.lineNumber / 100000;

  if (content.toLowerCase().includes(query)) {
    score += 10;
  }
  if (normalized.recordKind === "user-input") {
    score += 100;
  }
  if (normalized.recordKind === "assistant-output") {
    score += 20;
  }
  if (normalized.recordKind === "tool-result") {
    score -= 10;
  }

  return score;
}

function previewText(payload: Record<string, unknown>): string | undefined {
  return (
    stringField(payload, "prompt") ??
    stringField(payload, "last_assistant_message") ??
    stringField(payload, "lastAssistantMessage") ??
    stringField(payload, "tool_response") ??
    stringField(payload, "toolResponse") ??
    stringField(payload, "error") ??
    nestedStringField(payload, ["toolCall", "args", "toolSummary"]) ??
    nestedStringField(payload, ["toolCall", "args", "toolAction"]) ??
    nestedStringField(payload, ["toolCall", "args", "CommandLine"])
  );
}

function matchedTextFields(input: unknown, query: string): Array<{ path: string; value: string }> {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const matches: Array<{ path: string; value: string }> = [];
  walkTextFields(input, [], (path, value) => {
    if (value.toLowerCase().includes(needle)) {
      matches.push({ path: path.join("."), value: compactText(value) });
    }
  });
  return matches;
}

function matchedTranscriptDetails(event: Record<string, unknown>, query?: string): string {
  const matched = query ? matchedTextFields(event, query).slice(0, 6) : [];
  return matched.length > 0
    ? matched.map((field) => `${field.path}: ${field.value}`).join("\n")
    : JSON.stringify(event);
}

export function normalizeTranscriptRecord(record: TranscriptRecord): SmemHistoryRecord {
  const fromSource = detectTranscriptSource(record.transcriptPath);
  const sourceAgent = agentFromSource(fromSource);
  const source = stringField(record.event, "source");
  const type = stringField(record.event, "type");
  const message = recordField(record.event, "message");
  const payload = recordField(record.event, "payload");
  const content = cleanTranscriptContent(
    stringField(record.event, "content") ??
      transcriptContent(message) ??
      transcriptContent(payload) ??
      ""
  );
  const thinking = cleanTranscriptContent(stringField(record.event, "thinking") ?? "");
  const toolCalls = arrayField(record.event, "tool_calls");
  const role = stringField(record.event, "role") ?? stringField(message, "role") ?? stringField(payload, "role");
  const recordKind = transcriptRecordKind({
    ...(source ? { source } : {}),
    ...(type ? { type } : {}),
    ...(role ? { role } : {}),
    content,
    thinking,
    toolCalls
  });
  const timestamp = stringField(record.event, "created_at") ?? stringField(record.event, "timestamp");

  return {
    id: transcriptRecordId(record),
    fromSource,
    sourceAgent,
    sourcePath: record.transcriptPath,
    sourceLine: record.lineNumber,
    ...(timestamp ? { timestamp } : {}),
    role: roleForRecordKind(recordKind),
    recordKind,
    ...(content ? { content } : thinking ? { content: thinking } : {}),
    ...(record.event["type"] ? { type: String(record.event["type"]) } : {}),
    namespace: stringField(record.event, "namespace") ?? null,
    title: stringField(record.event, "title") ?? null,
    tags: Array.isArray(record.event["tags"]) ? (record.event["tags"] as string[]) : [],
    raw: record.event
  };
}

function detectTranscriptSource(path: string): SmemHistoryRecord["fromSource"] {
  if (path.includes("antigravity-cli")) {
    return "antigravity-transcript";
  }
  if (path.includes("claude")) {
    return "claude-code-transcript";
  }
  if (path.includes("codex")) {
    return "codex-transcript";
  }
  return "unknown-transcript";
}

function agentFromSource(source: SmemHistoryRecord["fromSource"]): SmemHistoryRecord["sourceAgent"] {
  switch (source) {
    case "antigravity-transcript":
      return "antigravity";
    case "claude-code-transcript":
      return "claude-code";
    case "codex-transcript":
      return "codex";
    case "unknown-transcript":
      return "unknown";
  }
}

function transcriptRecordKind(input: {
  source?: string;
  type?: string;
  role?: string;
  content: string;
  thinking: string;
  toolCalls: unknown[];
}): SmemHistoryRecord["recordKind"] {
  if (input.source === "USER_EXPLICIT" || input.type === "USER_INPUT") {
    return "user-input";
  }
  if (input.type === "user" || input.role === "user") {
    return "user-input";
  }
  if (input.type === "RUN_COMMAND") {
    return "tool-result";
  }
  if (input.source === "MODEL" && input.type === "PLANNER_RESPONSE" && input.content) {
    return "assistant-output";
  }
  if (input.source === "MODEL" && input.type === "PLANNER_RESPONSE" && input.thinking) {
    return "assistant-thinking";
  }
  if (input.type === "assistant" || input.role === "assistant" || input.type === "response_item") {
    return "assistant-output";
  }
  if (input.toolCalls.length > 0) {
    return "tool-call";
  }
  if (input.type === "CHECKPOINT" || input.type === "CONVERSATION_HISTORY") {
    return "metadata";
  }
  return "unknown";
}

function roleForRecordKind(kind: SmemHistoryRecord["recordKind"]): SmemHistoryRecord["role"] {
  if (kind === "user-input") {
    return "user";
  }
  if (kind === "assistant-output" || kind === "assistant-thinking") {
    return "assistant";
  }
  if (kind === "tool-call" || kind === "tool-result") {
    return "tool";
  }
  if (kind === "metadata") {
    return "system";
  }
  return "unknown";
}

function readableTranscriptDetails(record: SmemHistoryRecord, query?: string): string {
  const event = record.raw;
  const toolCalls = arrayField(event, "tool_calls");

  if (record.recordKind === "tool-result") {
    return commandResultSummary(record.raw);
  }

  const sections: string[] = [];
  if (record.content && record.recordKind !== "assistant-thinking") {
    sections.push(record.content);
  } else if (record.content && record.recordKind === "assistant-thinking") {
    sections.push(`Thought:\n${record.content}`);
  }

  if (toolCalls.length > 0) {
    sections.push(`Tools:\n${toolCalls.map(formatToolCall).join("\n")}`);
  }

  return sections.length > 0 ? sections.join("\n\n") : matchedTranscriptDetails(event, query);
}

function commandResultSummary(event: Record<string, unknown>): string {
  const exitCode = numberField(event, "exit_code");
  const content = cleanTranscriptContent(stringField(event, "content") ?? "");
  const lines = [`Command result: exit_code=${exitCode ?? "unknown"}`];

  const outputMatch = content.match(/(?:Output|Stdout):\s*([\s\S]*)/);
  const output = outputMatch?.[1]?.trim();
  if (output && !looksLikeJsonlDump(output)) {
    lines.push(compactText(output));
  }

  return lines.join("\n");
}

function looksLikeJsonlDump(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{\"step_index\"") || trimmed.includes("\n{\"step_index\"");
}

function formatToolCall(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `- ${compactText(String(value))}`;
  }

  const call = value as Record<string, unknown>;
  const name = stringField(call, "name") ?? "tool";
  const args = recordField(call, "args") ?? {};
  const summary = stringField(args, "toolSummary") ?? stringField(args, "toolAction");
  const command = stringField(args, "CommandLine");
  const path = stringField(args, "AbsolutePath");

  const detail = summary ?? command ?? path ?? JSON.stringify(args);
  return `- ${name}: ${compactText(detail)}`;
}

function cleanTranscriptContent(content: string): string {
  return content
    .replace(/<USER_REQUEST>\s*/g, "")
    .replace(/\s*<\/USER_REQUEST>/g, "")
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, "")
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, "")
    .trim();
}

function transcriptContent(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  const direct = stringField(input, "content") ?? stringField(input, "text");
  if (direct) {
    return direct;
  }
  const content = input["content"];
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts = content.flatMap((item) => {
    if (typeof item === "string") {
      return [item];
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      const text = stringField(record, "text") ?? stringField(record, "input_text") ?? stringField(record, "output_text");
      return text ? [text] : [];
    }
    return [];
  });
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function walkTextFields(input: unknown, path: string[], visit: (path: string[], value: string) => void): void {
  if (typeof input === "string") {
    visit(path, input);
    return;
  }

  if (Array.isArray(input)) {
    input.forEach((item, index) => walkTextFields(item, [...path, String(index)], visit));
    return;
  }

  if (input && typeof input === "object") {
    for (const [key, value] of Object.entries(input)) {
      walkTextFields(value, [...path, key], visit);
    }
  }
}

function compactText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 500 ? normalized : `${normalized.slice(0, 497)}...`;
}

function recordField(input: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = input?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringField(input: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = input?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberField(input: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = input?.[key];
  return typeof value === "number" ? value : undefined;
}

function arrayField(input: Record<string, unknown> | undefined, key: string): unknown[] {
  const value = input?.[key];
  return Array.isArray(value) ? value : [];
}

function nestedStringField(input: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = input;
  for (const part of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return typeof current === "string" && current.trim().length > 0 ? current.trim() : undefined;
}
