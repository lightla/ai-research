import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  installAgent,
  installAgentHooks,
  knownAgents,
  uninstallAgent,
  uninstallAgentHooks
} from "../src/install/agent-installer";
import { opencodePluginPath } from "../src/install/opencode-installer";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uninstalls bootstrap block without removing user instructions", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "smem-installer-"));
  tempDirs.push(projectDir);
  const agentsPath = join(projectDir, "AGENTS.md");

  writeFileSync(agentsPath, "# Project Rules\n\nKeep this line.\n", "utf8");
  installAgent({ agent: "codex", cwd: projectDir });

  expect(readFileSync(agentsPath, "utf8")).toContain("<!-- smem:start -->");

  const result = uninstallAgent({ agent: "codex", cwd: projectDir });

  expect(result.changed).toBe(true);
  expect(readFileSync(agentsPath, "utf8")).toBe("# Project Rules\n\nKeep this line.\n");
});

test("uninstalls only smem hook commands from mixed hook config", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "smem-installer-"));
  tempDirs.push(projectDir);
  installAgentHooks({ agent: "codex", cwd: projectDir });

  const hooksPath = join(projectDir, ".codex", "hooks.json");
  const hooks = JSON.parse(readFileSync(hooksPath, "utf8")) as {
    hooks: { UserPromptSubmit: Array<Record<string, unknown>> };
  };
  hooks.hooks.UserPromptSubmit.push({
    hooks: [
      {
        type: "command",
        command: "echo keep-me",
        timeout: 3
      }
    ]
  });
  writeFileSync(hooksPath, JSON.stringify(hooks, null, 2) + "\n", "utf8");

  const result = uninstallAgentHooks({ agent: "codex", cwd: projectDir });
  const next = readFileSync(hooksPath, "utf8");

  expect(result.changed).toBe(true);
  expect(next).not.toContain("smem hook run");
  expect(next).toContain("echo keep-me");
});

test("removes hook file when only smem hooks remain", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "smem-installer-"));
  tempDirs.push(projectDir);
  installAgentHooks({ agent: "claude-code", cwd: projectDir });

  const hooksPath = join(projectDir, ".claude", "settings.json");
  const result = uninstallAgentHooks({ agent: "claude-code", cwd: projectDir });

  expect(result.changed).toBe(true);
  expect(existsSync(hooksPath)).toBe(false);
});

test("installing hooks merges into an existing shared config instead of overwriting it", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "smem-installer-"));
  tempDirs.push(projectDir);
  const settingsPath = join(projectDir, ".claude", "settings.json");
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  writeFileSync(
    settingsPath,
    JSON.stringify(
      {
        colorScheme: "dark",
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "some-other-tool hook pre" }] }
          ]
        }
      },
      null,
      2
    ),
    "utf8"
  );

  installAgentHooks({ agent: "claude-code", cwd: projectDir });

  const after = JSON.parse(readFileSync(settingsPath, "utf8"));
  expect(after.colorScheme).toBe("dark");
  expect(after.hooks.PreToolUse).toHaveLength(1);
  expect(after.hooks.PreToolUse[0].hooks[0].command).toBe("some-other-tool hook pre");
  expect(after.hooks.UserPromptSubmit).toBeDefined();
  expect(after.hooks.PostToolUse).toBeDefined();
  expect(after.hooks.Stop).toBeDefined();
});

test("installing hooks twice does not duplicate smem's own entries", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "smem-installer-"));
  tempDirs.push(projectDir);

  installAgentHooks({ agent: "codex", cwd: projectDir });
  installAgentHooks({ agent: "codex", cwd: projectDir });

  const hooksPath = join(projectDir, ".codex", "hooks.json");
  const after = JSON.parse(readFileSync(hooksPath, "utf8"));
  expect(after.hooks.PostToolUse).toHaveLength(1);
});

test("installs and uninstalls hooks at a global (user-level) location", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-installer-home-"));
  tempDirs.push(home);

  const result = installAgentHooks({ agent: "claude-code", cwd: "/should/not/be/used", global: true, home });
  const globalPath = join(home, ".claude", "settings.json");
  expect(result.filePath).toBe(globalPath);
  expect(existsSync(globalPath)).toBe(true);
  expect(JSON.parse(readFileSync(globalPath, "utf8")).hooks.UserPromptSubmit).toBeDefined();

  const uninstallResult = uninstallAgentHooks({ agent: "claude-code", cwd: "/should/not/be/used", global: true, home });
  expect(uninstallResult.changed).toBe(true);
  expect(existsSync(globalPath)).toBe(false);
});

test("global install preserves other tools' entries in the shared global config", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-installer-home-"));
  tempDirs.push(home);
  const globalPath = join(home, ".claude", "settings.json");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(
    globalPath,
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] }] } }),
    "utf8"
  );

  installAgentHooks({ agent: "claude-code", cwd: "/unused", global: true, home });

  const after = JSON.parse(readFileSync(globalPath, "utf8"));
  expect(after.hooks.PreToolUse[0].hooks[0].command).toBe("rtk hook claude");
  expect(after.hooks.UserPromptSubmit).toBeDefined();
});

test("opencode is a known agent and bootstraps into AGENTS.md", () => {
  expect(knownAgents()).toContain("opencode");
  const projectDir = mkdtempSync(join(tmpdir(), "smem-installer-"));
  tempDirs.push(projectDir);

  installAgent({ agent: "opencode", cwd: projectDir });

  const agentsPath = join(projectDir, "AGENTS.md");
  expect(readFileSync(agentsPath, "utf8")).toContain("<!-- smem:start -->");

  const result = uninstallAgent({ agent: "opencode", cwd: projectDir });
  expect(result.changed).toBe(true);
  expect(readFileSync(agentsPath, "utf8")).not.toContain("<!-- smem:start -->");
});

test("installs opencode hooks as a plugin file instead of a JSON hook config", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "smem-installer-"));
  tempDirs.push(projectDir);

  const result = installAgentHooks({ agent: "opencode", cwd: projectDir });
  const pluginPath = join(projectDir, ".opencode", "plugin", "smem.ts");

  expect(result.changed).toBe(true);
  expect(result.filePath).toBe(pluginPath);
  expect(result.kind).toBe("hooks");
  expect(existsSync(pluginPath)).toBe(true);
  const content = readFileSync(pluginPath, "utf8");
  expect(content).toContain("smem hook run --agent opencode");
  expect(content).toContain('"chat.message"');
  expect(content).toContain('"tool.execute.after"');
  expect(content).toContain("dispose");
});

test("installing opencode hooks twice is idempotent", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "smem-installer-"));
  tempDirs.push(projectDir);

  const first = installAgentHooks({ agent: "opencode", cwd: projectDir });
  const second = installAgentHooks({ agent: "opencode", cwd: projectDir });

  expect(first.changed).toBe(true);
  expect(second.changed).toBe(false);
  expect(readFileSync(join(projectDir, ".opencode", "plugin", "smem.ts"), "utf8")).toContain("smem hook run --agent opencode");
});

test("uninstalling opencode hooks removes the smem plugin file", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "smem-installer-"));
  tempDirs.push(projectDir);
  installAgentHooks({ agent: "opencode", cwd: projectDir });

  const pluginPath = join(projectDir, ".opencode", "plugin", "smem.ts");
  const result = uninstallAgentHooks({ agent: "opencode", cwd: projectDir });

  expect(result.changed).toBe(true);
  expect(existsSync(pluginPath)).toBe(false);
});

test("uninstalling opencode hooks leaves a user-owned plugin untouched", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "smem-installer-"));
  tempDirs.push(projectDir);
  const pluginPath = join(projectDir, ".opencode", "plugin", "smem.ts");
  mkdirSync(dirname(pluginPath), { recursive: true });
  writeFileSync(pluginPath, "export default async () => ({})", "utf8");

  const result = uninstallAgentHooks({ agent: "opencode", cwd: projectDir });

  expect(result.changed).toBe(false);
  expect(readFileSync(pluginPath, "utf8")).toBe("export default async () => ({})");
});

test("opencode global hooks install to ~/.config/opencode/plugin/smem.ts", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-installer-home-"));
  tempDirs.push(home);

  const result = installAgentHooks({ agent: "opencode", cwd: "/should/not/be/used", global: true, home });
  const globalPath = join(home, ".config", "opencode", "plugin", "smem.ts");

  expect(result.filePath).toBe(globalPath);
  expect(result.filePath).toBe(opencodePluginPath({ cwd: "/unused", global: true, home }));
  expect(existsSync(globalPath)).toBe(true);

  const uninstallResult = uninstallAgentHooks({ agent: "opencode", cwd: "/should/not/be/used", global: true, home });
  expect(uninstallResult.changed).toBe(true);
  expect(existsSync(globalPath)).toBe(false);
});
