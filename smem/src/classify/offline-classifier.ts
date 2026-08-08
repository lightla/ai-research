import { detectVietnamese, extractEntities, extractKeywords } from "./keywords";
import { buildLexiconPattern, isLexiconCategory, loadLexicon } from "./lexicon";
import { defaultSmartMemoryHome } from "../core/paths";

export type ClassifierKind = "smem-rule" | "wink-nlp" | "llm";

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
    kind: "smem-rule";
    version: string;
    confidence: number;
  };
};

// Pure regex/heuristic, no POS tagger, no ML model — see keywords.ts for why: a
// statistical English model (this used to be wink-nlp) mistags Vietnamese syllables and
// shreds compounds like "phụ thuộc" into garbage fragments ("thu", "vào" survive as
// "keywords" while the actual content word "thuộc" is dropped). Bilingual by construction
// instead, at the cost of being "basic rules" rather than a trained model.
const VERSION = "smem-rule@1.1.0";

// Trigger *words* for decision/todo/preference/error/question/context live in lexicon.ts, not
// here, because that list is meant to grow: lexicon-learning.ts tracks words that keep showing
// up in promoted memories without matching any current trigger, and `smem lexicon suggest`
// surfaces them once the same word has been confirmed by a human promotion often enough. This
// is still 0 LLM — it never infers meaning from one message, it only counts repeats across many
// human-confirmed promotions, which is a stronger and cheaper signal than a single guess.
//
// Structural rules stay hardcoded because a word list can't express "ends with a question mark"
// or "starts with a slash" — those aren't vocabulary, they're shape.
const STRUCTURAL_RULES: Partial<Record<OfflineLabel, RegExp[]>> = {
  question: [/\?$/],
  command: [/^\s*(smem|npm|pnpm|node|git|curl|bash|sh|python|codex|claude)\b/i, /^\s*\/[a-z][\w-]*/i]
};

// Fixed check order, matching the original hardcoded rule order — only matters for which label
// ends up as `primaryLabel` when a text matches more than one.
const LABEL_ORDER: OfflineLabel[] = ["decision", "todo", "preference", "error", "question", "command", "context"];

export function classifyText(text: string, home: string = defaultSmartMemoryHome()): OfflineClassification {
  const normalized = text.trim();
  const labels = classifyLabels(normalized, home);
  const keywords = extractKeywords(normalized);
  const entities = extractEntities(normalized);
  const topics = extractTopics(keywords, entities);

  const primaryLabel = labels[0] ?? "note";

  return {
    labels,
    primaryLabel,
    topics,
    keywords,
    entities,
    languageHint: detectLanguageHint(normalized),
    classifier: {
      kind: "smem-rule",
      version: VERSION,
      confidence: confidence(labels, keywords, normalized)
    }
  };
}

function classifyLabels(text: string, home: string): OfflineLabel[] {
  const lexicon = loadLexicon(home);
  const labels: OfflineLabel[] = [];

  for (const label of LABEL_ORDER) {
    const lexiconPattern = isLexiconCategory(label) ? buildLexiconPattern(lexicon, label) : undefined;
    const structuralPatterns = STRUCTURAL_RULES[label] ?? [];
    const matched = (lexiconPattern && lexiconPattern.test(text)) || structuralPatterns.some((pattern) => pattern.test(text));
    if (matched) {
      labels.push(label);
    }
  }

  return labels.length > 0 ? labels : ["note"];
}

function extractTopics(keywords: string[], entities: string[]): string[] {
  return [...entities.map((entity) => entity.toLowerCase()), ...keywords]
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index)
    .slice(0, 8);
}

export function detectLanguageHint(text: string): OfflineClassification["languageHint"] {
  if (detectVietnamese(text)) {
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
