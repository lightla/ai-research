import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  classifyWithLlm,
  parseLlmResponse
} from "../src/classify/llm-classifier";
import { resolveLlmClassifierConfig } from "../src/core/config";
import { processCandidates } from "../src/process/candidate-processor";
import { RegistryRepository } from "../src/storage/registry-repository";
import { MemoryRepository } from "../src/storage/memory-repository";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.SMEM_CLASSIFIER;
  delete process.env.SMEM_LLM_MODEL;
  delete process.env.SMEM_LLM_BASE_URL;
  delete process.env.SMEM_LLM_API_KEY;
  delete process.env.SMEM_LLM_TIMEOUT_MS;
});

describe("resolveLlmClassifierConfig", () => {
  test("returns undefined when classifier is offline or unset", () => {
    expect(resolveLlmClassifierConfig({ env: {} })).toBeUndefined();
    expect(resolveLlmClassifierConfig({ env: { SMEM_CLASSIFIER: "offline" } })).toBeUndefined();
    expect(resolveLlmClassifierConfig({ env: { SMEM_CLASSIFIER: "wink-nlp" } })).toBeUndefined();
  });

  test("resolves ollama defaults with a local OpenAI-compatible endpoint", () => {
    const config = resolveLlmClassifierConfig({
      env: { SMEM_CLASSIFIER: "ollama", SMEM_LLM_MODEL: "llama3.1:8b" }
    });
    expect(config).toEqual({
      provider: "ollama",
      model: "llama3.1:8b",
      baseUrl: "http://localhost:11434/v1",
      timeoutMs: 15000
    });
  });

  test("resolves an openai provider with api key and trailing-slash base url trimmed", () => {
    const config = resolveLlmClassifierConfig({
      env: {
        SMEM_CLASSIFIER: "openai",
        SMEM_LLM_MODEL: "gpt-4o-mini",
        SMEM_LLM_API_KEY: "sk-test",
        SMEM_LLM_BASE_URL: "https://api.example.com/v1/",
        SMEM_LLM_TIMEOUT_MS: "5000"
      }
    });
    expect(config).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      timeoutMs: 5000
    });
  });

  test("throws when a model is missing", () => {
    expect(() => resolveLlmClassifierConfig({ env: { SMEM_CLASSIFIER: "ollama" } })).toThrow(/No LLM model configured/);
  });

  test("throws when an openai provider has no api key", () => {
    expect(() =>
      resolveLlmClassifierConfig({ env: { SMEM_CLASSIFIER: "openai", SMEM_LLM_MODEL: "gpt-4o-mini" } })
    ).toThrow(/api-key/);
  });
});

describe("parseLlmResponse", () => {
  test("parses strict JSON output", () => {
    const parsed = parseLlmResponse(
      '{"labels":["decision","todo"],"primaryLabel":"decision","topics":["database","migration"],"keywords":["sqlite","schema"],"entities":["SQLite"],"confidence":0.92}',
      "quyết định dùng SQLite cho storage"
    );
    expect(parsed).toEqual({
      labels: ["decision", "todo"],
      primaryLabel: "decision",
      topics: ["database", "migration"],
      keywords: ["sqlite", "schema"],
      entities: ["SQLite"],
      confidence: 0.92
    });
  });

  test("extracts JSON wrapped in markdown fences", () => {
    const parsed = parseLlmResponse(
      '```json\n{"labels":["preference"],"primaryLabel":"preference","topics":[],"keywords":[],"entities":[],"confidence":0.8}\n```',
      "from now on use conventional commits"
    );
    expect(parsed.primaryLabel).toBe("preference");
    expect(parsed.labels).toEqual(["preference"]);
  });

  test("coerces invalid labels and clamps confidence", () => {
    const parsed = parseLlmResponse(
      '{"labels":["bogus","todo"],"primaryLabel":"bogus","topics":[],"keywords":[],"entities":[],"confidence":1.7}',
      "todo: remember to handle migrations"
    );
    expect(parsed.labels).toEqual(["todo"]);
    expect(parsed.primaryLabel).toBe("todo");
    expect(parsed.confidence).toBe(1);
  });

  test("throws when the response has no usable JSON", () => {
    expect(() => parseLlmResponse("sorry, cannot do that", "hello")).toThrow(/valid JSON/);
  });
});

describe("classifyWithLlm", () => {
  test("sends a chat completion and returns an llm classification", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: '{"labels":["error"],"primaryLabel":"error","topics":["build"],"keywords":["compile"],"entities":[],"confidence":0.95}' } }]
        };
      }
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await classifyWithLlm(
      "npm run build failed with a compile error",
      {
        provider: "ollama",
        model: "llama3.1:8b",
        baseUrl: "http://localhost:11434/v1",
        timeoutMs: 5000
      }
    );

    expect(result.classifier.kind).toBe("llm");
    expect(result.classifier.provider).toBe("ollama");
    expect(result.classifier.version).toBe("llm@ollama/llama3.1:8b");
    expect(result.labels).toEqual(["error"]);
    expect(result.languageHint).toBe("en");

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("http://localhost:11434/v1/chat/completions");
    const body = JSON.parse(String(call[1]?.body)) as { model: string; messages: Array<{ role: string }> };
    expect(body.model).toBe("llama3.1:8b");
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[1]?.role).toBe("user");
  });

  test("rejects when the provider returns an error status", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 502,
      async text() {
        return "upstream failure";
      }
    })) as unknown as typeof fetch;

    await expect(
      classifyWithLlm("hello", {
        provider: "ollama",
        model: "llama3.1:8b",
        baseUrl: "http://localhost:11434/v1",
        timeoutMs: 5000
      })
    ).rejects.toThrow(/502/);
  });
});

describe("processCandidates with an llm classifier", () => {
  test("enriches captured events to llm classification and keeps wink-nlp as fallback", async () => {
    const home = mkdtempSync(join(tmpdir(), "smem-test-"));
    const projectDir = mkdtempSync(join(tmpdir(), "smem-project-"));
    const tempDirs: string[] = [home, projectDir];
    const registry = new RegistryRepository(home);
    const project = registry.initProject({ cwd: projectDir, name: "demo" });
    registry.close();

    mkdirSync(join(home, "events"), { recursive: true });
    writeFileSync(
      join(home, "events", "pending.jsonl"),
      `${JSON.stringify({
        eventId: "evt_llm_enriched",
        agent: "codex",
        event: "UserPromptSubmit",
        captureKind: "raw-input",
        projectPath: projectDir,
        signal: "high",
        payload: { prompt: "chốt dùng PostgreSQL, việc còn: migrate schema" }
      })}\n`,
      "utf8"
    );

    process.env.SMEM_CLASSIFIER = "ollama";
    process.env.SMEM_LLM_MODEL = "llama3.1:8b";
    process.env.SMEM_LLM_BASE_URL = "http://localhost:11434/v1";
    globalThis.fetch = (async () => ({
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: '{"labels":["decision","todo"],"primaryLabel":"decision","topics":["database"],"keywords":["postgresql","migration"],"entities":["PostgreSQL"],"confidence":0.93}' } }]
        };
      }
    })) as unknown as typeof fetch;

    try {
      const result = await processCandidates({ project, scope: "local", home });
      const memories = new MemoryRepository(project, { home });
      const candidate = memories.listCandidates()[0];
      const source = candidate?.source as Record<string, unknown>;
      const classifier = source?.["classifier"] as { kind?: string } | undefined;
      const classification = source?.["classification"] as { primaryLabel?: string; classifier?: { kind?: string } } | undefined;
      expect(result.created).toBe(1);
      expect(classifier?.kind).toBe("llm");
      expect(classification?.primaryLabel).toBe("decision");
      expect(classification?.classifier?.kind).toBe("llm");
      memories.close();
    } finally {
      for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
