import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { classifyText, type ClassifierKind, type OfflineClassification } from "../classify/offline-classifier";
import type { LlmClassification } from "../classify/llm-classifier";
import { createEventId } from "../core/ids";
import { defaultSmartMemoryHome } from "../core/paths";
import type { AgentName } from "../install/agent-installer";
import { redactJsonValue } from "./redact";

export type HookEventInput = Record<string, unknown>;

export type NormalizedHookEvent = {
  eventId: string;
  agent: AgentName;
  event: string;
  captureKind: "raw-input" | "raw-output" | "tool-event" | "raw-event";
  sessionId: string;
  turnId?: string;
  projectPath?: string;
  transcriptPath?: string;
  timestamp: string;
  signal: "low" | "medium" | "high";
  creator: {
    kind: "agent-hook";
    agent: AgentName;
  };
  classifier: {
    kind: ClassifierKind;
    version: string;
    confidence: number;
  };
  classification: OfflineClassification | LlmClassification;
  payload: HookEventInput;
};

export function appendHookEvent(options: {
  agent: AgentName;
  eventOverride?: string;
  input: HookEventInput;
  home?: string;
}): NormalizedHookEvent {
  const home = options.home ?? defaultSmartMemoryHome();
  const event = normalizeHookEvent(options.agent, options.input, options.eventOverride, home);
  const queueDir = join(home, "events");
  mkdirSync(queueDir, { recursive: true });
  appendFileSync(join(queueDir, "pending.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

function normalizeHookEvent(
  agent: AgentName,
  rawInput: HookEventInput,
  eventOverride: string | undefined,
  home: string
): NormalizedHookEvent {
  // Redact before anything else touches this payload: it gets written verbatim to
  // pending.jsonl (read back by `smem raw`/`smem history`), classified (extracted
  // keywords/entities land in candidate memory tags), and optionally sent to an LLM
  // classifier — a leaked API key in a captured bash command must not survive any of that.
  const input = redactJsonValue(rawInput);
  const event = eventOverride ?? stringField(input, "hook_event_name") ?? stringField(input, "hookEventName") ?? "unknown";
  const projectPath = projectPathForAgent(agent, input);
  const transcriptPath = stringField(input, "transcript_path") ?? stringField(input, "transcriptPath");
  const turnId = stringField(input, "turn_id");
  const classification = classifyText(textForClassification(input), home);

  return {
    eventId: createEventId(),
    agent,
    event,
    captureKind: classifyCaptureKind(event),
    sessionId:
      stringField(input, "session_id") ??
      stringField(input, "conversationId") ??
      stringField(input, "sessionId") ??
      "unknown",
    ...(turnId ? { turnId } : {}),
    ...(projectPath ? { projectPath } : {}),
    ...(transcriptPath ? { transcriptPath } : {}),
    timestamp: new Date().toISOString(),
    signal: classifySignal(event, input),
    creator: {
      kind: "agent-hook",
      agent
    },
    classifier: {
      kind: classification.classifier.kind,
      version: classification.classifier.version,
      confidence: classification.classifier.confidence
    },
    classification,
    payload: input
  };
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

function projectPathForAgent(agent: AgentName, input: HookEventInput): string | undefined {
  if (agent === "antigravity") {
    const workspacePaths = input["workspacePaths"];
    return Array.isArray(workspacePaths) && typeof workspacePaths[0] === "string"
      ? workspacePaths[0]
      : undefined;
  }

  return stringField(input, "cwd");
}

function classifySignal(event: string, input: HookEventInput): "low" | "medium" | "high" {
  const text = JSON.stringify(input).toLowerCase();
  const error = stringField(input, "error");

  if (event === "UserPromptSubmit" && text.includes("/smem")) {
    return "high";
  }

  if (
    text.includes("decision") ||
    text.includes("quyết định") ||
    text.includes("quyet dinh") ||
    text.includes("chốt") ||
    text.includes("chot") ||
    text.includes("remember") ||
    text.includes("nhớ") ||
    text.includes("nho") ||
    text.includes("todo") ||
    text.includes("open loop") ||
    text.includes("cần làm") ||
    text.includes("can lam")
  ) {
    return "high";
  }

  if ((error && error.trim().length > 0) || text.includes("failed") || text.includes("exception")) {
    return "medium";
  }

  return "low";
}

function confidenceForEvent(event: string, input: HookEventInput): number {
  const signal = classifySignal(event, input);
  if (signal === "high") {
    return 0.75;
  }
  if (signal === "medium") {
    return 0.55;
  }
  return 0.35;
}

function stringField(input: HookEventInput, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function textForClassification(input: HookEventInput): string {
  const direct =
    stringField(input, "prompt") ??
    stringField(input, "last_assistant_message") ??
    stringField(input, "lastAssistantMessage") ??
    stringField(input, "tool_response") ??
    stringField(input, "toolResponse") ??
    stringField(input, "error");
  if (direct) {
    return direct;
  }

  return JSON.stringify(input);
}
