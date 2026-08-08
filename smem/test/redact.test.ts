import { expect, test } from "vitest";
import { redactJsonValue, redactText } from "../src/hook/redact";
import { appendHookEvent } from "../src/hook/event-queue";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("redacts known secret shapes in plain text", () => {
  expect(redactText("api_key=sk-ant-abcdefghijklmnopqrstuvwxyz123456")).toContain("[REDACTED_SECRET]");
  expect(redactText("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U")).toContain(
    "[REDACTED_SECRET]"
  );
  expect(redactText("token: ghp_1234567890abcdefghijklmnopqrstuvwxyz")).toContain("[REDACTED_SECRET]");
  expect(redactText("<private>my diary entry</private>")).toBe("[REDACTED]");
  expect(redactText("just a normal sentence, nothing secret here")).toBe("just a normal sentence, nothing secret here");
});

test("redacts secrets nested inside a JSON value without breaking its shape", () => {
  const input = {
    tool_name: "Bash",
    tool_input: { command: "curl -H 'Authorization: Bearer sk-proj-abcdefghijklmnopqrstuvwxyz123456' https://api.example.com" },
    ok: true
  };

  const redacted = redactJsonValue(input);
  expect(redacted.tool_name).toBe("Bash");
  expect(redacted.ok).toBe(true);
  expect(redacted.tool_input.command).toContain("[REDACTED_SECRET]");
  expect(redacted.tool_input.command).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz123456");
});

test("appendHookEvent never persists a secret from raw hook input to pending.jsonl", () => {
  const home = mkdtempSync(join(tmpdir(), "smem-test-"));
  tempDirs.push(home);

  appendHookEvent({
    agent: "claude-code",
    eventOverride: "PostToolUse",
    input: {
      session_id: "s1",
      tool_name: "Bash",
      tool_response: "export OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456 && run build"
    },
    home
  });

  const written = readFileSync(join(home, "events", "pending.jsonl"), "utf8");
  expect(written).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz123456");
  expect(written).toContain("[REDACTED_SECRET]");
});
