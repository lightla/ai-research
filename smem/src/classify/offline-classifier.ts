import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

// wink-nlp exposes `its` as a CommonJS helper with package-specific function types.
// Keep the loose boundary local to this adapter.
const its = require("wink-nlp/src/its.js") as any;

const nlp = winkNLP(model);

export type OfflineLabel =
  | "decision"
  | "todo"
  | "preference"
  | "error"
  | "question"
  | "command"
  | "context"
  | "note";

export type OfflineClassification = {
  labels: OfflineLabel[];
  primaryLabel: OfflineLabel;
  topics: string[];
  keywords: string[];
  entities: string[];
  languageHint: "mixed" | "en" | "unknown";
  classifier: {
    kind: "wink-nlp";
    version: string;
    confidence: number;
  };
};

const VERSION = "wink-nlp@2.4.0+wink-eng-lite-web-model@1.8.1";

const LABEL_RULES: Array<{ label: OfflineLabel; patterns: RegExp[] }> = [
  {
    label: "decision",
    patterns: [/\b(decide|decision|choose|chosen|approved|reject|rejected)\b/i, /\b(chốt|quyết định|lựa chọn)\b/i]
  },
  {
    label: "todo",
    patterns: [/\b(todo|open loop|follow[- ]?up|pending|next step)\b/i, /\b(cần làm|việc còn|chưa xong|bước tiếp)\b/i]
  },
  {
    label: "preference",
    patterns: [/\b(prefer|preference|from now on|always use|never use|convention)\b/i, /\b(từ nay|quy ước|ưu tiên)\b/i]
  },
  {
    label: "error",
    patterns: [/\b(error|failed|failure|exception|stack trace|crash|bug)\b/i, /\b(lỗi|fail|hỏng)\b/i]
  },
  {
    label: "question",
    patterns: [/\?$/, /\b(why|what|how|when|where|should|can we)\b/i, /\b(tại sao|như nào|làm sao|có nên)\b/i]
  },
  {
    label: "command",
    patterns: [/^\s*(smem|npm|pnpm|node|git|curl|bash|sh|python|codex|claude)\b/i, /^\s*\/[a-z][\w-]*/i]
  },
  {
    label: "context",
    patterns: [/\b(context|architecture|design|rationale|because|constraint)\b/i, /\b(ngữ cảnh|kiến trúc|thiết kế|lý do|ràng buộc)\b/i]
  }
];

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "for",
  "of",
  "in",
  "on",
  "is",
  "are",
  "be",
  "with",
  "this",
  "that",
  "it",
  "as",
  "by",
  "from",
  "và",
  "là",
  "của",
  "cho",
  "mình",
  "bạn",
  "này",
  "đó",
  "thì",
  "với"
]);

export function classifyText(text: string): OfflineClassification {
  const normalized = text.trim();
  const doc = nlp.readDoc(normalized);
  const lemmas = doc.tokens().out(its.lemma) as string[];
  const values = doc.tokens().out(its.value) as string[];
  const pos = doc.tokens().out(its.pos) as string[];
  const entities = doc.entities().out() as string[];
  const labels = classifyLabels(normalized);
  const keywords = extractKeywords(lemmas, values, pos);
  const topics = extractTopics(keywords, entities);

  const primaryLabel = labels[0] ?? "note";

  return {
    labels,
    primaryLabel,
    topics,
    keywords,
    entities,
    languageHint: languageHint(normalized),
    classifier: {
      kind: "wink-nlp",
      version: VERSION,
      confidence: confidence(labels, keywords, normalized)
    }
  };
}

function classifyLabels(text: string): OfflineLabel[] {
  const labels: OfflineLabel[] = [];
  for (const rule of LABEL_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      labels.push(rule.label);
    }
  }

  return labels.length > 0 ? labels : ["note"];
}

function extractKeywords(lemmas: string[], values: string[], pos: string[]): string[] {
  const counts = new Map<string, number>();
  for (let index = 0; index < lemmas.length; index += 1) {
    const raw = (lemmas[index] ?? values[index] ?? "").toLowerCase();
    const tag = pos[index] ?? "";
    const token = raw.replace(/[^\p{L}\p{N}_-]/gu, "");
    if (!token || token.length < 3 || STOPWORDS.has(token)) {
      continue;
    }
    if (!["NOUN", "PROPN", "VERB", "ADJ", "INTJ"].includes(tag)) {
      continue;
    }
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([token]) => token);
}

function extractTopics(keywords: string[], entities: string[]): string[] {
  return [...entities.map((entity) => entity.toLowerCase()), ...keywords].filter((value, index, values) => {
    return value.length > 0 && values.indexOf(value) === index;
  }).slice(0, 8);
}

function languageHint(text: string): OfflineClassification["languageHint"] {
  if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text)) {
    return "mixed";
  }
  if (/[a-z]/i.test(text)) {
    return "en";
  }
  return "unknown";
}

function confidence(labels: OfflineLabel[], keywords: string[], text: string): number {
  let score = 0.35;
  if (labels.length > 0 && labels[0] !== "note") {
    score += 0.25;
  }
  if (keywords.length >= 3) {
    score += 0.15;
  }
  if (text.length > 40) {
    score += 0.1;
  }
  return Math.min(score, 0.9);
}
