import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type AgentName = "codex" | "claude-code" | "antigravity";

export type InstallResult = {
  agent: AgentName;
  filePath: string;
  changed: boolean;
  kind: "bootstrap" | "hooks";
};

const AGENTS: Record<AgentName, { fileName: string; displayName: string }> = {
  codex: {
    fileName: "AGENTS.md",
    displayName: "Codex"
  },
  "claude-code": {
    fileName: "CLAUDE.md",
    displayName: "Claude Code"
  },
  antigravity: {
    fileName: "AGENTS.md",
    displayName: "Antigravity"
  }
};

const START = "<!-- smem:start -->";
const END = "<!-- smem:end -->";

export function installAgent(options: { agent: AgentName; cwd: string; dryRun?: boolean }): InstallResult {
  const config = AGENTS[options.agent];
  const filePath = join(resolve(options.cwd), config.fileName);
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const block = buildBlock();

  const next = upsertBlock(existing, block);
  const changed = next !== existing;

  if (changed && !options.dryRun) {
    writeFileSync(filePath, next, "utf8");
  }

  return {
    agent: options.agent,
    filePath,
    changed,
    kind: "bootstrap"
  };
}

export function installAgentHooks(options: { agent: AgentName; cwd: string; dryRun?: boolean }): InstallResult {
  const cwd = resolve(options.cwd);
  const filePath = hookFilePath(options.agent, cwd);
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const next = JSON.stringify(hookConfig(options.agent), null, 2) + "\n";
  const changed = existing !== next;

  if (changed && !options.dryRun) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, next, "utf8");
  }

  return {
    agent: options.agent,
    filePath,
    changed,
    kind: "hooks"
  };
}

export function uninstallAgent(options: { agent: AgentName; cwd: string; dryRun?: boolean }): InstallResult {
  const config = AGENTS[options.agent];
  const filePath = join(resolve(options.cwd), config.fileName);
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const next = removeBlock(existing);
  const changed = next !== existing;

  if (changed && !options.dryRun) {
    writeFileSync(filePath, next, "utf8");
  }

  return {
    agent: options.agent,
    filePath,
    changed,
    kind: "bootstrap"
  };
}

export function uninstallAgentHooks(options: { agent: AgentName; cwd: string; dryRun?: boolean }): InstallResult {
  const cwd = resolve(options.cwd);
  const filePath = hookFilePath(options.agent, cwd);
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";

  if (!existing) {
    return {
      agent: options.agent,
      filePath,
      changed: false,
      kind: "hooks"
    };
  }

  const next = removeHookConfig(existing, options.agent);
  const changed = next !== existing;

  if (changed && !options.dryRun) {
    if (next.trim()) {
      writeFileSync(filePath, next, "utf8");
    } else {
      rmSync(filePath, { force: true });
    }
  }

  return {
    agent: options.agent,
    filePath,
    changed,
    kind: "hooks"
  };
}

export function installAgents(options: { agents: AgentName[]; cwd: string; dryRun?: boolean }): InstallResult[] {
  const dryRun = options.dryRun ?? false;
  const results: InstallResult[] = [];

  for (const agent of options.agents) {
    const result = installAgent({ agent, cwd: options.cwd, dryRun });
    results.push(result);
  }

  return results;
}

export function installAgentsHooks(options: { agents: AgentName[]; cwd: string; dryRun?: boolean }): InstallResult[] {
  const dryRun = options.dryRun ?? false;
  return options.agents.map((agent) => installAgentHooks({ agent, cwd: options.cwd, dryRun }));
}

export function uninstallAgents(options: { agents: AgentName[]; cwd: string; dryRun?: boolean }): InstallResult[] {
  const dryRun = options.dryRun ?? false;
  return options.agents.map((agent) => uninstallAgent({ agent, cwd: options.cwd, dryRun }));
}

export function uninstallAgentsHooks(options: { agents: AgentName[]; cwd: string; dryRun?: boolean }): InstallResult[] {
  const dryRun = options.dryRun ?? false;
  return options.agents.map((agent) => uninstallAgentHooks({ agent, cwd: options.cwd, dryRun }));
}

export function parseAgentName(value: string): AgentName {
  if (value === "codex" || value === "claude-code" || value === "antigravity") {
    return value;
  }

  throw new Error(`Invalid agent: ${value}. Expected codex, claude-code, or antigravity.`);
}

export function knownAgents(): AgentName[] {
  return ["codex", "claude-code", "antigravity"];
}

function upsertBlock(existing: string, block: string): string {
  if (!existing.trim()) {
    return `${block}\n`;
  }

  const startIndex = existing.indexOf(START);
  const endIndex = existing.indexOf(END);

  if (startIndex >= 0 && endIndex > startIndex) {
    const before = existing.slice(0, startIndex).trimEnd();
    const after = existing.slice(endIndex + END.length).trimStart();
    return [before, block, after].filter(Boolean).join("\n\n") + "\n";
  }

  return `${existing.trimEnd()}\n\n${block}\n`;
}

function removeBlock(existing: string): string {
  const startIndex = existing.indexOf(START);
  const endIndex = existing.indexOf(END);

  if (startIndex < 0 || endIndex <= startIndex) {
    return existing;
  }

  const before = existing.slice(0, startIndex).trimEnd();
  const after = existing.slice(endIndex + END.length).trimStart();
  const next = [before, after].filter(Boolean).join("\n\n");
  return next ? `${next}\n` : "";
}

function removeHookConfig(existing: string, agent: AgentName): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    return existing;
  }

  const next = removeSmemHookCommands(parsed, agent);
  if (isEmptyJson(next)) {
    return "";
  }

  return JSON.stringify(next, null, 2) + "\n";
}

function removeSmemHookCommands(value: unknown, agent: AgentName): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => removeSmemHookCommands(item, agent))
      .filter((item) => !isEmptyJson(item) && !isSmemHookCommand(item, agent));
  }

  if (value && typeof value === "object") {
    if (isSmemHookCommand(value, agent)) {
      return undefined;
    }

    const entries = Object.entries(value)
      .map(([key, item]) => [key, removeSmemHookCommands(item, agent)] as const)
      .filter(([, item]) => !isEmptyJson(item));

    const hadHooks = Object.prototype.hasOwnProperty.call(value, "hooks");
    const keptKeys = entries.map(([key]) => key);
    if (hadHooks && !keptKeys.includes("hooks") && keptKeys.every((key) => key === "matcher")) {
      return undefined;
    }

    return Object.fromEntries(entries);
  }

  return value;
}

function isSmemHookCommand(value: unknown, agent: AgentName): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const command = (value as { command?: unknown }).command;
  return typeof command === "string" && command.startsWith(`smem hook run --agent ${agent} `);
}

function isEmptyJson(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return typeof value === "object" && Object.keys(value).length === 0;
}

function buildBlock(): string {
  return `${START}
## Smart Memory

This project uses **smem** for persistent memory shared across agents.

When you need to understand how to use smem, run:

\`\`\`bash
smem guide
\`\`\`

When the user says "continue", "what is this project doing?", "read project memory", or asks about previous decisions, run:

\`\`\`bash
smem context
\`\`\`

Use \`smem recall <query>\` for specific past decisions, conventions, errors, or rationale.

Use \`smem store\` after important decisions, preferences, resolved errors, or open loops.
${END}`;
}

function hookFilePath(agent: AgentName, cwd: string): string {
  switch (agent) {
    case "codex":
      return join(cwd, ".codex", "hooks.json");
    case "claude-code":
      return join(cwd, ".claude", "settings.json");
    case "antigravity":
      return join(cwd, ".agents", "hooks.json");
  }
}

function hookConfig(agent: AgentName): Record<string, unknown> {
  switch (agent) {
    case "codex":
      return {
        hooks: {
          UserPromptSubmit: [codexHandler(agent, "UserPromptSubmit")],
          PostToolUse: [codexMatcherHandler(agent, "PostToolUse", "*")],
          Stop: [codexHandler(agent, "Stop")]
        }
      };
    case "claude-code":
      return {
        hooks: {
          UserPromptSubmit: [claudeHandler(agent, "UserPromptSubmit")],
          PostToolUse: [claudeMatcherHandler(agent, "PostToolUse", "*")],
          Stop: [claudeHandler(agent, "Stop")]
        }
      };
    case "antigravity":
      return {
        "smem-capture": {
          PreInvocation: [antigravityCommand(agent, "PreInvocation")],
          PostInvocation: [antigravityCommand(agent, "PostInvocation")],
          Stop: [antigravityCommand(agent, "Stop")],
          PostToolUse: [
            {
              matcher: "*",
              hooks: [antigravityCommand(agent, "PostToolUse")]
            }
          ]
        }
      };
  }
}

function codexHandler(agent: AgentName, event: string): Record<string, unknown> {
  return {
    hooks: [
      {
        type: "command",
        command: `smem hook run --agent ${agent} --event ${event}`,
        timeout: 3
      }
    ]
  };
}

function codexMatcherHandler(agent: AgentName, event: string, matcher: string): Record<string, unknown> {
  return {
    matcher,
    hooks: [
      {
        type: "command",
        command: `smem hook run --agent ${agent} --event ${event}`,
        timeout: 3
      }
    ]
  };
}

function claudeHandler(agent: AgentName, event: string): Record<string, unknown> {
  return {
    hooks: [
      {
        type: "command",
        command: `smem hook run --agent ${agent} --event ${event}`,
        timeout: 3
      }
    ]
  };
}

function claudeMatcherHandler(agent: AgentName, event: string, matcher: string): Record<string, unknown> {
  return {
    matcher,
    hooks: [
      {
        type: "command",
        command: `smem hook run --agent ${agent} --event ${event}`,
        timeout: 3,
        async: true
      }
    ]
  };
}

function antigravityCommand(agent: AgentName, event: string): Record<string, unknown> {
  return {
    type: "command",
    command: `smem hook run --agent ${agent} --event ${event}`,
    timeout: 3
  };
}
