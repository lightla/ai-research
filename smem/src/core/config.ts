import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LlmClassifierConfig, LlmClassifierProvider } from "../classify/llm-classifier";
import { defaultSmartMemoryHome } from "./paths";

export type ClassifierProvider = "offline" | "ollama" | "openai";

export type ClassifierConfig = {
  provider: ClassifierProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
};

export type SmemConfig = {
  classifier: ClassifierConfig;
};

export type ConfigField = "provider" | "model" | "baseUrl" | "apiKey" | "timeoutMs";

export const DEFAULT_CONFIG: SmemConfig = Object.freeze({
  classifier: Object.freeze({ provider: "offline" as const })
});

export const CONFIG_FIELDS: Array<{ field: ConfigField; key: string }> = [
  { field: "provider", key: "classifier" },
  { field: "model", key: "model" },
  { field: "baseUrl", key: "base-url" },
  { field: "apiKey", key: "api-key" },
  { field: "timeoutMs", key: "timeout-ms" }
];

export function configPath(home = defaultSmartMemoryHome()): string {
  return join(home, "config.json");
}

export function loadConfig(home = defaultSmartMemoryHome()): SmemConfig {
  const path = configPath(home);
  if (!existsSync(path)) {
    return defaultConfig();
  }
  try {
    return normalizeConfig(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(config: SmemConfig, home = defaultSmartMemoryHome()): void {
  const path = configPath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function parseConfigKey(raw: string): ConfigField | undefined {
  const key = raw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^llm/, "");
  switch (key) {
    case "classifier":
    case "provider":
      return "provider";
    case "model":
      return "model";
    case "baseurl":
    case "url":
      return "baseUrl";
    case "apikey":
    case "key":
      return "apiKey";
    case "timeoutms":
    case "timeout":
    case "ms":
      return "timeoutMs";
    default:
      return undefined;
  }
}

export function coerceConfigValue(field: ConfigField, value: string): string {
  const trimmed = value.trim();
  if (field === "provider") {
    const normalized = trimmed.toLowerCase();
    if (normalized === "offline" || normalized === "wink-nlp" || normalized === "local" || normalized === "off") {
      return "offline";
    }
    if (normalized === "ollama") {
      return "ollama";
    }
    if (normalized === "openai" || normalized === "openai-compatible") {
      return "openai";
    }
    throw new Error(`Invalid classifier provider "${value}". Use: offline, ollama, or openai.`);
  }
  if (field === "timeoutMs") {
    const number = Number(trimmed);
    if (!Number.isInteger(number) || number <= 0) {
      throw new Error(`Invalid timeout "${value}". Use a positive integer (milliseconds).`);
    }
    return String(number);
  }
  if (field === "baseUrl" && !/^https?:\/\//i.test(trimmed)) {
    throw new Error(`Invalid base URL "${value}". It must start with http:// or https://.`);
  }
  if (!trimmed) {
    throw new Error(`A value is required for ${field}.`);
  }
  return trimmed;
}

export function setConfigValue(key: string, value: string, home = defaultSmartMemoryHome()): ConfigField {
  const field = parseConfigKey(key);
  if (!field) {
    throw new Error(unknownKeyMessage(key));
  }
  const applied = coerceConfigValue(field, value);
  const config = loadConfig(home);
  if (field === "provider") {
    config.classifier.provider = applied as ClassifierProvider;
  } else if (field === "timeoutMs") {
    config.classifier.timeoutMs = Number(applied);
  } else {
    (config.classifier as Record<string, unknown>)[field] = applied;
  }
  saveConfig(config, home);
  return field;
}

export function unsetConfigValue(key: string, home = defaultSmartMemoryHome()): ConfigField {
  const field = parseConfigKey(key);
  if (!field) {
    throw new Error(unknownKeyMessage(key));
  }
  const config = loadConfig(home);
  if (field === "provider") {
    config.classifier.provider = "offline";
  } else {
    delete config.classifier[field];
  }
  saveConfig(config, home);
  return field;
}

export function resolveLlmClassifierConfig(
  options: { home?: string; env?: Record<string, string | undefined> } = {}
): LlmClassifierConfig | undefined {
  const env = options.env ?? process.env;
  const file = loadConfig(options.home).classifier;

  const rawProvider = env.SMEM_CLASSIFIER ?? file.provider;
  const provider: LlmClassifierProvider | "offline" =
    rawProvider === "openai" || rawProvider === "openai-compatible"
      ? "openai"
      : rawProvider === "ollama"
        ? "ollama"
        : "offline";
  if (provider === "offline") {
    return undefined;
  }

  const model = env.SMEM_LLM_MODEL ?? file.model;
  if (!model) {
    throw new Error("No LLM model configured. Set one with: smem config set model <name>");
  }

  const baseUrl =
    env.SMEM_LLM_BASE_URL ??
    file.baseUrl ??
    (provider === "ollama" ? "http://localhost:11434/v1" : "https://api.openai.com/v1");
  const apiKey = env.SMEM_LLM_API_KEY ?? file.apiKey;
  if (provider === "openai" && !apiKey) {
    throw new Error("Set an LLM API key with: smem config set api-key <key>");
  }

  return {
    provider,
    model,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    ...(apiKey ? { apiKey } : {}),
    timeoutMs: resolveTimeoutMs(env.SMEM_LLM_TIMEOUT_MS, file.timeoutMs)
  };
}

function resolveTimeoutMs(envValue: string | undefined, fileValue: number | undefined): number {
  const raw = envValue ?? (fileValue === undefined ? "" : String(fileValue));
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15000;
}

function defaultConfig(): SmemConfig {
  return {
    classifier: { ...DEFAULT_CONFIG.classifier }
  };
}

function normalizeConfig(raw: unknown): SmemConfig {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const classifierRecord = record["classifier"];
  const classifier =
    classifierRecord && typeof classifierRecord === "object" && !Array.isArray(classifierRecord)
      ? (classifierRecord as Record<string, unknown>)
      : {};
  const provider = classifier["provider"] === "ollama" || classifier["provider"] === "openai" ? classifier["provider"] : "offline";

  return {
    classifier: {
      provider,
      ...(typeof classifier["model"] === "string" && classifier["model"].trim() ? { model: classifier["model"].trim() } : {}),
      ...(typeof classifier["baseUrl"] === "string" && classifier["baseUrl"].trim() ? { baseUrl: classifier["baseUrl"].trim() } : {}),
      ...(typeof classifier["apiKey"] === "string" && classifier["apiKey"].trim() ? { apiKey: classifier["apiKey"].trim() } : {}),
      ...(typeof classifier["timeoutMs"] === "number" && Number.isFinite(classifier["timeoutMs"]) && (classifier["timeoutMs"] as number) > 0 ? { timeoutMs: classifier["timeoutMs"] as number } : {})
    }
  };
}

function unknownKeyMessage(key: string): string {
  return `Unknown config key "${key}". Known keys: ${CONFIG_FIELDS.map((item) => item.key).join(", ")}.`;
}
