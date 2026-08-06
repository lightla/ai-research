import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { installOpencodeHooks, uninstallOpencodeHooks } from "./opencode-installer";

export type AgentName = "codex" | "claude-code" | "antigravity" | "opencode";

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
  },
  opencode: {
    fileName: "AGENTS.md",
    displayName: "OpenCode"
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

export function installAgentHooks(options: {
  agent: AgentName;
  cwd: string;
  global?: boolean;
  home?: string;
  dryRun?: boolean;
}): InstallResult {
  if (options.agent === "opencode") {
    return installOpencodeHooks({
      cwd: resolve(options.cwd),
      ...(options.global !== undefined ? { global: options.global } : {}),
      ...(options.home ? { home: options.home } : {}),
      dryRun: options.dryRun ?? false
    });
  }
  const filePath = options.global
    ? globalHookFilePath(options.agent, options.home)
    : hookFilePath(options.agent, resolve(options.cwd));
  return writeMergedHooks(options.agent, filePath, options.dryRun ?? false);
}

function writeMergedHooks(agent: AgentName, filePath: string, dryRun: boolean): InstallResult {
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const merged = mergeHookConfig(existing, agent);
  const next = JSON.stringify(merged, null, 2) + "\n";
  const changed = existing !== next;

  if (changed && !dryRun) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, next, "utf8");
  }

  return {
    agent,
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

export function uninstallAgentHooks(options: {
  agent: AgentName;
  cwd: string;
  global?: boolean;
  home?: string;
  dryRun?: boolean;
}): InstallResult {
  if (options.agent === "opencode") {
    return uninstallOpencodeHooks({
      cwd: resolve(options.cwd),
      ...(options.global !== undefined ? { global: options.global } : {}),
      ...(options.home ? { home: options.home } : {}),
      dryRun: options.dryRun ?? false
    });
  }
  const filePath = options.global
    ? globalHookFilePath(options.agent, options.home)
    : hookFilePath(options.agent, resolve(options.cwd));
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

export function installAgentsHooks(options: { agents: AgentName[]; cwd: string; global?: boolean; dryRun?: boolean }): InstallResult[] {
  const dryRun = options.dryRun ?? false;
  return options.agents.map((agent) =>
    installAgentHooks({ agent, cwd: options.cwd, dryRun, ...(options.global !== undefined ? { global: options.global } : {}) })
  );
}

export function uninstallAgents(options: { agents: AgentName[]; cwd: string; dryRun?: boolean }): InstallResult[] {
  const dryRun = options.dryRun ?? false;
  return options.agents.map((agent) => uninstallAgent({ agent, cwd: options.cwd, dryRun }));
}

export function uninstallAgentsHooks(options: { agents: AgentName[]; cwd: string; global?: boolean; dryRun?: boolean }): InstallResult[] {
  const dryRun = options.dryRun ?? false;
  return options.agents.map((agent) =>
    uninstallAgentHooks({ agent, cwd: options.cwd, dryRun, ...(options.global !== undefined ? { global: options.global } : {}) })
  );
}

export function parseAgentName(value: string): AgentName {
  if (value === "codex" || value === "claude-code" || value === "antigravity" || value === "opencode") {
    return value;
  }

  throw new Error(`Invalid agent: ${value}. Expected codex, claude-code, antigravity, or opencode.`);
}

export function knownAgents(): AgentName[] {
  return ["codex", "claude-code", "antigravity", "opencode"];
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
    case "opencode":
      throw new Error("opencode hooks are installed as an opencode plugin; there is no JSON hook file.");
  }
}

// User-level equivalent of hookFilePath, so a hook applies to every project without a per-project
// install. Claude Code is confirmed to read hooks from `~/.claude/settings.json`. Codex and
// Antigravity's global config locations are inferred by analogy with their per-project layout and
// are not independently verified — test by chatting once after install and checking `smem raw`.
// opencode is handled separately: it has no JSON hook file, so `installOpencodeHooks` targets
// `~/.config/opencode/plugin/smem.ts` instead of reaching this function.
function globalHookFilePath(agent: AgentName, home?: string): string {
  return hookFilePath(agent, home ?? homedir());
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
    case "opencode":
      throw new Error("opencode hooks are installed as an opencode plugin; there is no JSON hook config.");
  }
}

// `.claude/settings.json` and `.codex/hooks.json` are general-purpose config files other tools
// also write hook entries into, so installing smem's hooks must merge into the existing per-event
// arrays rather than overwrite the file — `.agents/hooks.json` is smem-owned by convention (nested
// under its own "smem-capture" key) so a plain merge at the top level is sufficient there.
function mergeHookConfig(existingRaw: string, agent: AgentName): Record<string, unknown> {
  let existing: Record<string, unknown> = {};
  if (existingRaw.trim()) {
    try {
      const parsed = JSON.parse(existingRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // Existing file isn't valid JSON; fall back to treating it as empty rather than guessing.
    }
  }

  const incoming = hookConfig(agent);

  if (agent === "antigravity") {
    return { ...existing, ...incoming };
  }

  const existingHooks =
    existing["hooks"] && typeof existing["hooks"] === "object" && !Array.isArray(existing["hooks"])
      ? (existing["hooks"] as Record<string, unknown[]>)
      : {};
  const incomingHooks = (incoming["hooks"] as Record<string, unknown[]>) ?? {};

  const mergedHooks: Record<string, unknown[]> = { ...existingHooks };
  for (const [eventName, entries] of Object.entries(incomingHooks)) {
    const current = Array.isArray(mergedHooks[eventName]) ? mergedHooks[eventName] : [];
    const withoutOurs = current.filter((entry) => !isOwnHookGroup(entry, agent));
    mergedHooks[eventName] = [...withoutOurs, ...entries];
  }

  return { ...existing, hooks: mergedHooks };
}

function isOwnHookGroup(entry: unknown, agent: AgentName): boolean {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  const hooks = (entry as { hooks?: unknown }).hooks;
  return Array.isArray(hooks) && hooks.some((hook) => isSmemHookCommand(hook, agent));
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
