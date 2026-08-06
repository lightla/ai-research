import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  coerceConfigValue,
  loadConfig,
  parseConfigKey,
  resolveLlmClassifierConfig,
  saveConfig,
  setConfigValue,
  unsetConfigValue,
  type ClassifierConfig
} from "../src/core/config";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "smem-config-"));
  tempDirs.push(home);
  return home;
}

describe("parseConfigKey", () => {
  test("maps dotted, dashed, and plain aliases to config fields", () => {
    expect(parseConfigKey("classifier")).toBe("provider");
    expect(parseConfigKey("llm.provider")).toBe("provider");
    expect(parseConfigKey("model")).toBe("model");
    expect(parseConfigKey("llm.model")).toBe("model");
    expect(parseConfigKey("base-url")).toBe("baseUrl");
    expect(parseConfigKey("llm.base-url")).toBe("baseUrl");
    expect(parseConfigKey("api-key")).toBe("apiKey");
    expect(parseConfigKey("timeout-ms")).toBe("timeoutMs");
  });

  test("returns undefined for unknown keys", () => {
    expect(parseConfigKey("bogus")).toBeUndefined();
  });
});

describe("coerceConfigValue", () => {
  test("normalizes provider aliases", () => {
    expect(coerceConfigValue("provider", "offline")).toBe("offline");
    expect(coerceConfigValue("provider", "wink-nlp")).toBe("offline");
    expect(coerceConfigValue("provider", "local")).toBe("offline");
    expect(coerceConfigValue("provider", "OLLAMA")).toBe("ollama");
    expect(coerceConfigValue("provider", "openai-compatible")).toBe("openai");
  });

  test("rejects unknown providers and malformed numbers and urls", () => {
    expect(() => coerceConfigValue("provider", "grok")).toThrow(/Invalid classifier provider/);
    expect(() => coerceConfigValue("timeoutMs", "fast")).toThrow(/Invalid timeout/);
    expect(() => coerceConfigValue("baseUrl", "localhost:11434")).toThrow(/Invalid base URL/);
  });
});

describe("config file persistence", () => {
  test("loadConfig returns defaults when no file exists", () => {
    expect(loadConfig(tempHome())).toEqual({ classifier: { provider: "offline" } });
  });

  test("setConfigValue persists values and unset removes them", () => {
    const home = tempHome();
    setConfigValue("classifier", "ollama", home);
    setConfigValue("model", "gemma4:31b-cloud", home);

    expect(loadConfig(home)).toEqual({
      classifier: { provider: "ollama", model: "gemma4:31b-cloud" }
    });

    unsetConfigValue("model", home);
    expect(loadConfig(home).classifier.model).toBeUndefined();

    unsetConfigValue("classifier", home);
    expect(loadConfig(home).classifier.provider).toBe("offline");
  });

  test("saveConfig persists timeoutMs as a number", () => {
    const home = tempHome();
    setConfigValue("timeout-ms", "5000", home);
    expect(loadConfig(home).classifier.timeoutMs).toBe(5000);
  });
});

describe("resolveLlmClassifierConfig from file config", () => {
  test("returns undefined by default (offline)", () => {
    const home = tempHome();
    expect(resolveLlmClassifierConfig({ home, env: {} })).toBeUndefined();
  });

  test("reads the configured provider and model from the config file", () => {
    const home = tempHome();
    saveConfig(
      { classifier: { provider: "ollama", model: "gemma4:31b-cloud" } },
      home
    );
    expect(resolveLlmClassifierConfig({ home, env: {} })).toEqual({
      provider: "ollama",
      model: "gemma4:31b-cloud",
      baseUrl: "http://localhost:11434/v1",
      timeoutMs: 15000
    });
  });

  test("env overrides the file configuration", () => {
    const home = tempHome();
    saveConfig(
      { classifier: { provider: "ollama", model: "gemma4:31b-cloud" } },
      home
    );
    expect(resolveLlmClassifierConfig({ home, env: { SMEM_LLM_MODEL: "llama3.1:8b" } })?.model).toBe(
      "llama3.1:8b"
    );
  });

  test("throws with a CLI hint when a provider is enabled without a model", () => {
    const home = tempHome();
    saveConfig({ classifier: { provider: "ollama" } as ClassifierConfig }, home);
    expect(() => resolveLlmClassifierConfig({ home, env: {} })).toThrow(/smem config set model/);
  });

  test("throws with a CLI hint when openai is enabled without an api key", () => {
    const home = tempHome();
    saveConfig({ classifier: { provider: "openai", model: "gpt-4o-mini" } }, home);
    expect(() => resolveLlmClassifierConfig({ home, env: {} })).toThrow(/smem config set api-key/);
  });
});
