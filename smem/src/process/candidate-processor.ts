import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { classifyText } from "../classify/offline-classifier";
import { base58FromBytes } from "../core/ids";
import { defaultSmartMemoryHome } from "../core/paths";
import type { MemoryInput, MemoryType, ProjectRecord } from "../core/schema";
import type { AgentName } from "../install/agent-installer";
import type { HookEventInput, NormalizedHookEvent } from "../hook/event-queue";
import { MemoryRepository } from "../storage/memory-repository";

export type ProcessResult = {
  scanned: number;
  created: number;
  skipped: number;
};

export function processCandidates(options: {
  project: ProjectRecord;
  scope: "local" | "global";
  home?: string;
  limit?: number;
}): ProcessResult {
  const home = options.home ?? defaultSmartMemoryHome();
  const queuePath = join(home, "events", "pending.jsonl");
  if (!existsSync(queuePath)) {
    return { scanned: 0, created: 0, skipped: 0 };
  }

  const events = readEvents(queuePath).slice(-(options.limit ?? 200));
  const repo = new MemoryRepository(options.project, { scope: options.scope, home });
  let scanned = 0;
  let created = 0;
  let skipped = 0;

  try {
    for (const event of events) {
      scanned += 1;
      if (!shouldCreateCandidate(event, options.project)) {
        skipped += 1;
        continue;
      }
      if (repo.hasSourceEvent(event.eventId)) {
        skipped += 1;
        continue;
      }

      repo.create(candidateInput(event), {
        status: "pending-review",
        sourceKind: "raw-capture-candidate",
        sourceAgent: event.agent,
        source: {
          rawEventId: event.eventId,
          captureKind: event.captureKind,
          classifier: event.classifier,
          classification: event.classification,
          sessionId: event.sessionId,
          transcriptPath: event.transcriptPath
        }
      });
      created += 1;
    }
  } finally {
    repo.close();
  }

  return { scanned, created, skipped };
}

function readEvents(path: string): NormalizedHookEvent[] {
  return readFileSync(path, "utf8")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [normalizeRawEvent(JSON.parse(line) as Record<string, unknown>, line)];
      } catch {
        return [];
      }
    });
}

function shouldCreateCandidate(event: NormalizedHookEvent, project: ProjectRecord): boolean {
  if (!textForCandidate(event)) {
    return false;
  }

  if (event.signal === "low" && event.classification.classifier.confidence < 0.65) {
    return false;
  }

  if (event.projectPath && resolve(event.projectPath) !== resolve(project.rootPath)) {
    return false;
  }

  return ["decision", "todo", "preference", "error", "context"].includes(event.classification.primaryLabel);
}

function normalizeRawEvent(raw: Record<string, unknown>, originalLine: string): NormalizedHookEvent {
  const payload = recordField(raw, "payload") ?? raw;
  const event = stringField(raw, "event") ?? stringField(payload, "hook_event_name") ?? stringField(payload, "hookEventName") ?? "unknown";
  const classification = isClassification(raw["classification"])
    ? raw["classification"]
    : classifyText(textForClassification(payload));
  const agent = agentField(raw["agent"]);
  const projectPath = stringField(raw, "projectPath") ?? projectPathFromPayload(agent, payload);
  const transcriptPath = stringField(raw, "transcriptPath") ?? stringField(payload, "transcriptPath") ?? stringField(payload, "transcript_path");
  const eventId = stringField(raw, "eventId") ?? legacyEventId(originalLine);
  const turnId = stringField(raw, "turnId");
  const sessionId =
    stringField(raw, "sessionId") ??
    stringField(payload, "session_id") ??
    stringField(payload, "conversationId") ??
    stringField(payload, "sessionId") ??
    "unknown";

  return {
    eventId,
    agent,
    event,
    captureKind: captureKindField(raw["captureKind"]) ?? classifyCaptureKind(event),
    sessionId,
    ...(turnId ? { turnId } : {}),
    ...(projectPath ? { projectPath } : {}),
    ...(transcriptPath ? { transcriptPath } : {}),
    timestamp: stringField(raw, "timestamp") ?? new Date().toISOString(),
    signal: signalField(raw["signal"]) ?? classifySignal(event, payload),
    creator: {
      kind: "agent-hook",
      agent
    },
    classifier: classifierField(raw["classifier"]) ?? {
      kind: classification.classifier.kind,
      version: classification.classifier.version,
      confidence: classification.classifier.confidence
    },
    classification,
    payload
  };
}

function legacyEventId(line: string): string {
  return `evt_legacy_${base58FromBytes(createHash("sha256").update(line).digest().subarray(0, 16))}`;
}

function agentField(value: unknown): AgentName {
  return value === "codex" || value === "claude-code" || value === "antigravity" ? value : "codex";
}

function signalField(value: unknown): NormalizedHookEvent["signal"] | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function captureKindField(value: unknown): NormalizedHookEvent["captureKind"] | undefined {
  return value === "raw-input" || value === "raw-output" || value === "tool-event" || value === "raw-event"
    ? value
    : undefined;
}

function classifierField(value: unknown): NormalizedHookEvent["classifier"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const kind = record["kind"];
  const version = record["version"];
  const confidence = record["confidence"];
  if ((kind !== "smem-rule" && kind !== "wink-nlp") || typeof version !== "string" || typeof confidence !== "number") {
    return undefined;
  }

  return { kind, version, confidence };
}

function isClassification(value: unknown): value is NormalizedHookEvent["classification"] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record["primaryLabel"] === "string" &&
    Array.isArray(record["topics"]) &&
    Boolean(classifierField(record["classifier"]))
  );
}

function classifyCaptureKind(event: string): NormalizedHookEvent["captureKind"] {
  if (event === "UserPromptSubmit" || event === "PreInvocation") {
    return "raw-input";
  }
  if (event === "Stop" || event === "PostInvocation") {
    return "raw-output";
  }
  if (event === "PostToolUse" || event === "PreToolUse") {
    return "tool-event";
  }
  return "raw-event";
}

function classifySignal(event: string, input: HookEventInput): NormalizedHookEvent["signal"] {
  const text = JSON.stringify(input).toLowerCase();
  const error = stringField(input, "error");

  if (event === "UserPromptSubmit" && text.includes("/smem")) {
    return "high";
  }

  if (
    text.includes("decision") ||
    text.includes("quyết định") ||
    text.includes("chốt") ||
    text.includes("remember") ||
    text.includes("nhớ") ||
    text.includes("todo") ||
    text.includes("open loop")
  ) {
    return "high";
  }

  if ((error && error.trim().length > 0) || text.includes("failed") || text.includes("exception")) {
    return "medium";
  }

  return "low";
}

function projectPathFromPayload(agent: AgentName, input: HookEventInput): string | undefined {
  if (agent === "antigravity") {
    const workspacePaths = input["workspacePaths"];
    return Array.isArray(workspacePaths) && typeof workspacePaths[0] === "string" ? workspacePaths[0] : undefined;
  }

  return stringField(input, "cwd");
}

function candidateInput(event: NormalizedHookEvent): MemoryInput {
  const type = memoryTypeForLabel(event.classification.primaryLabel);
  const text = textForCandidate(event) ?? JSON.stringify(event.payload);
  return {
    type,
    title: titleForCandidate(event),
    content: text,
    tags: event.classification.topics.slice(0, 8),
    status: "pending-review"
  };
}

function memoryTypeForLabel(label: string): MemoryType {
  if (label === "decision" || label === "todo" || label === "preference" || label === "error" || label === "context") {
    return label;
  }
  return "note";
}

function titleForCandidate(event: NormalizedHookEvent): string {
  const label = event.classification.primaryLabel;
  const topic = event.classification.topics[0] ?? event.classification.keywords[0] ?? event.captureKind;
  return `${label}: ${topic}`;
}

function textForCandidate(event: NormalizedHookEvent): string | undefined {
  const payload = event.payload;
  const direct = stringField(payload, "prompt") ??
    stringField(payload, "last_assistant_message") ??
    stringField(payload, "lastAssistantMessage") ??
    stringField(payload, "tool_response") ??
    stringField(payload, "toolResponse") ??
    nonEmptyStringField(payload, "error");
  return direct;
}

function textForClassification(input: HookEventInput): string {
  const direct =
    stringField(input, "prompt") ??
    stringField(input, "last_assistant_message") ??
    stringField(input, "lastAssistantMessage") ??
    stringField(input, "tool_response") ??
    stringField(input, "toolResponse") ??
    stringField(input, "error");
  return direct ?? JSON.stringify(input);
}

function recordField(input: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = input[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function nonEmptyStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = stringField(input, key);
  return value && value.trim().length > 0 ? value : undefined;
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
