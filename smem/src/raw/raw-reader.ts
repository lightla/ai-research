import { existsSync, readFileSync } from "node:fs";
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
  raw: Record<string, unknown>;
};

export type RawSearchResult = {
  events: RawEventRecord[];
  transcripts: TranscriptRecord[];
};

export type RawThreadResult = {
  anchor: TranscriptRecord | null;
  records: TranscriptRecord[];
};

export function searchRaw(options: {
  query: string;
  home?: string;
  limit?: number;
  agent?: string;
  kind?: string;
}): RawSearchResult {
  const events = searchRawEvents(options);
  const transcripts = searchReferencedTranscripts(options);
  return { events, transcripts };
}

export function searchRawEvents(options: {
  query: string;
  home?: string;
  limit?: number;
  agent?: string;
  kind?: string;
}): RawEventRecord[] {
  const queuePath = join(options.home ?? defaultSmartMemoryHome(), "events", "pending.jsonl");
  if (!existsSync(queuePath)) {
    return [];
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

    matches.push({
      lineNumber: index + 1,
      line,
      event
    });
  }

  return matches.slice(-(options.limit ?? 20)).reverse();
}

export function searchReferencedTranscripts(options: {
  query: string;
  home?: string;
  limit?: number;
  agent?: string;
  kind?: string;
}): TranscriptRecord[] {
  const query = options.query.trim().toLowerCase();
  if (!query) {
    return [];
  }

  const transcriptPaths = transcriptPathsFromRawEvents(options);
  const matches: TranscriptRecord[] = [];

  for (const transcriptPath of transcriptPaths) {
    if (!existsSync(transcriptPath)) {
      continue;
    }

    const lines = readFileSync(transcriptPath, "utf8").split(/\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim();
      if (!line || !line.toLowerCase().includes(query)) {
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

  return matches
    .sort((left, right) => transcriptRank(right, query) - transcriptRank(left, query))
    .slice(0, options.limit ?? 20);
}

export function rawThread(options: {
  query: string;
  home?: string;
  after?: number;
  agent?: string;
  kind?: string;
}): RawThreadResult {
  const [anchor] = searchReferencedTranscripts({
    query: options.query,
    limit: 1,
    ...(options.home ? { home: options.home } : {}),
    ...(options.agent ? { agent: options.agent } : {}),
    ...(options.kind ? { kind: options.kind } : {})
  });
  if (!anchor || !existsSync(anchor.transcriptPath)) {
    return { anchor: null, records: [] };
  }

  const after = options.after ?? 10;
  const records: TranscriptRecord[] = [];
  const lines = readFileSync(anchor.transcriptPath, "utf8").split(/\n/);
  const end = Math.min(lines.length, anchor.lineNumber + after);

  for (let lineNumber = anchor.lineNumber; lineNumber <= end; lineNumber += 1) {
    const line = lines[lineNumber - 1]?.trim();
    if (!line) {
      continue;
    }

    try {
      records.push({
        transcriptPath: anchor.transcriptPath,
        lineNumber,
        event: JSON.parse(line) as Record<string, unknown>
      });
    } catch {
      continue;
    }
  }

  return { anchor, records };
}

export function summarizeRawEvent(record: RawEventRecord, query?: string): string {
  const event = record.event;
  const classification = recordField(event, "classification");
  const payload = recordField(event, "payload") ?? {};
  const parts = [
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

function normalizeTranscriptRecord(record: TranscriptRecord): SmemHistoryRecord {
  const fromSource = detectTranscriptSource(record.transcriptPath);
  const sourceAgent = agentFromSource(fromSource);
  const source = stringField(record.event, "source");
  const type = stringField(record.event, "type");
  const content = cleanTranscriptContent(stringField(record.event, "content") ?? "");
  const thinking = cleanTranscriptContent(stringField(record.event, "thinking") ?? "");
  const toolCalls = arrayField(record.event, "tool_calls");
  const recordKind = transcriptRecordKind({
    ...(source ? { source } : {}),
    ...(type ? { type } : {}),
    content,
    thinking,
    toolCalls
  });
  const timestamp = stringField(record.event, "created_at");

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
  content: string;
  thinking: string;
  toolCalls: unknown[];
}): SmemHistoryRecord["recordKind"] {
  if (input.source === "USER_EXPLICIT" || input.type === "USER_INPUT") {
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
