import { readFileSync } from "node:fs";
import { appendHookEvent, type HookEventInput } from "./event-queue";
import type { AgentName } from "../install/agent-installer";

export function runHook(options: { agent: AgentName; event?: string }): void {
  const raw = readFileSync(0, "utf8").trim();
  const input = raw ? (JSON.parse(raw) as HookEventInput) : {};
  appendHookEvent({
    agent: options.agent,
    ...(options.event ? { eventOverride: options.event } : {}),
    input
  });

  process.stdout.write(JSON.stringify(outputForAgent(options.agent, options.event, input)));
}

function outputForAgent(agent: AgentName, event: string | undefined, input: HookEventInput): Record<string, unknown> {
  if (agent === "antigravity") {
    if (event === "Stop") {
      return { decision: "allow" };
    }
    return {};
  }

  if (agent === "codex" && event === "UserPromptSubmit" && isSmemPrompt(input)) {
    return {
      decision: "block",
      reason: "smem command captured locally."
    };
  }

  if (agent === "claude-code" && event === "UserPromptSubmit" && isSmemPrompt(input)) {
    return {
      decision: "block",
      reason: "smem command captured locally."
    };
  }

  return {};
}

function isSmemPrompt(input: HookEventInput): boolean {
  const prompt = input["prompt"];
  return typeof prompt === "string" && prompt.trim().startsWith("/smem");
}
