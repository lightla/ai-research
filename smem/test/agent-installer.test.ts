import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  installAgent,
  installAgentHooks,
  uninstallAgent,
  uninstallAgentHooks
} from "../src/install/agent-installer";

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
