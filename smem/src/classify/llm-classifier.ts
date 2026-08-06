import { classifyText, detectLanguageHint, type OfflineClassification, type OfflineLabel } from "./offline-classifier";

export type LlmClassifierProvider = "ollama" | "openai";

export type LlmClassifierConfig = {
  provider: LlmClassifierProvider;
  model: string;
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
};

export type LlmClassification = Omit<OfflineClassification, "classifier"> & {
  classifier: {
    kind: "llm";
    provider: LlmClassifierProvider;
    model: string;
    version: string;
    confidence: number;
  };
};

const SYSTEM_PROMPT = [
  "You are a memory tagging engine for an AI coding assistant. Analyze the given text (English and Vietnamese mixed).",
  "Return STRICT JSON only, with no markdown fences, matching this exact shape:",
  '{"labels":["decision","todo"],"primaryLabel":"decision","topics":["topic 1","topic 2"],"keywords":["keyword 1","keyword 2"],"entities":["entity 1"],"confidence":0.9}',
  "Rules:",
  "- labels: 1-3 most relevant values chosen only from: decision, todo, preference, error, question, command, context, note.",
  "- primaryLabel: the single most relevant label.",
  "- topics: 2-8 short topic phrases.",
  "- keywords: 2-8 key terms.",
  "- entities: named things such as libraries, tools, people, files.",
  "- confidence: a number 0.0-1.0 reflecting how confident you are about primaryLabel.",
  "Label definitions:",
  "decision = a choice was made or approved; todo = an action item or follow-up; preference = how the user wants to work from now on;",
  "error = a failure, bug, or exception; question = something needing an answer; command = a shell/CLI invocation;",
  "context = background, architecture, design, or rationale; note = everything else."
].join("\n");

export async function classifyWithLlm(text: string, config: LlmClassifierConfig): Promise<LlmClassification> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Text:\n${text.slice(0, 4000)}` }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM classification failed (${response.status}): ${body}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    const parsed = parseLlmResponse(content, text);

    return {
      labels: parsed.labels,
      primaryLabel: parsed.primaryLabel,
      topics: parsed.topics,
      keywords: parsed.keywords,
      entities: parsed.entities,
      languageHint: detectLanguageHint(text),
      classifier: {
        kind: "llm",
        provider: config.provider,
        model: config.model,
        version: `llm@${config.provider}/${config.model}`,
        confidence: parsed.confidence
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function parseLlmResponse(content: string, text: string): {
  labels: OfflineLabel[];
  primaryLabel: OfflineLabel;
  topics: string[];
  keywords: string[];
  entities: string[];
  confidence: number;
} {
  const json = extractJson(content);
  if (!json) {
    throw new Error("LLM response did not contain valid JSON.");
  }

  const fallback = classifyText(text);
  const labels = normalizeLabels(json["labels"], fallback.labels);
  const rawPrimary = typeof json["primaryLabel"] === "string" ? json["primaryLabel"].trim().toLowerCase() : "";
  const primaryLabel = labels.includes(rawPrimary as OfflineLabel)
    ? (rawPrimary as OfflineLabel)
    : labels[0] ?? fallback.primaryLabel;

  return {
    labels,
    primaryLabel,
    topics: uniqueStrings(json["topics"], fallback.topics, 8),
    keywords: uniqueStrings(json["keywords"], fallback.keywords, 12),
    entities: uniqueStrings(json["entities"], fallback.entities, 8),
    confidence: normalizeConfidence(json["confidence"], fallback.classifier.confidence)
  };
}

function extractJson(content: string): Record<string, unknown> | undefined {
  const trimmed = content.trim();
  const parse = (value: string): Record<string, unknown> | undefined => {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not valid JSON; try a substring below.
    }
    return undefined;
  };

  const direct = parse(trimmed);
  if (direct) {
    return direct;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return parse(trimmed.slice(start, end + 1));
  }
  return undefined;
}

function normalizeLabels(value: unknown, fallback: OfflineLabel[]): OfflineLabel[] {
  const valid = new Set<string>(["decision", "todo", "preference", "error", "question", "command", "context", "note"]);
  const labels = stringArray(value)
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is OfflineLabel => valid.has(item));
  return labels.length > 0 ? [...new Set(labels)].slice(0, 5) : fallback;
}

function uniqueStrings(value: unknown, fallback: string[], limit: number): string[] {
  const items = stringArray(value)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const merged = items.length > 0 ? items : fallback;
  return [...new Set(merged)].slice(0, limit);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeConfidence(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, 0), 1);
}
