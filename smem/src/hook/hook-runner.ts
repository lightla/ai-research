import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { appendHookEvent, type HookEventInput, type NormalizedHookEvent } from "./event-queue";
import type { AgentName } from "../install/agent-installer";

export function runHook(options: { agent: AgentName; event?: string }): void {
  const raw = readFileSync(0, "utf8").trim();
  const input = raw ? (JSON.parse(raw) as HookEventInput) : {};
  const captured = appendHookEvent({
    agent: options.agent,
    ...(options.event ? { eventOverride: options.event } : {}),
    input
  });

  triggerBackgroundProcess(captured);

  process.stdout.write(JSON.stringify(outputForAgent(options.agent, options.event, input)));
}

function triggerBackgroundProcess(event: NormalizedHookEvent): void {
  if (event.captureKind !== "raw-input" && event.captureKind !== "raw-output") {
    return;
  }

  // Native hooks must return immediately. The child only runs offline processing
  // and creates review candidates; it never promotes or deletes raw captures.
  const entrypoint = process.argv[1];
  if (!entrypoint || !entrypoint.endsWith(".js")) {
    return;
  }

  try {
    const child = spawn(process.execPath, [entrypoint, "process", "--background", "--limit", "200"], {
      cwd: event.projectPath ?? process.cwd(),
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        SMEM_PROCESS_TRIGGER: "hook"
      }
    });
    child.unref();
  } catch {
    // Capture must remain successful even if background processing cannot start.
  }
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
