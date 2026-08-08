import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultSmartMemoryHome } from "../core/paths";
import type { OfflineLabel } from "./offline-classifier";
import { withUnicodeWordBoundary } from "./regex-utils";

// Word-list categories only. "command" and the bare "?" ending for "question" stay structural
// (leading `/`, known CLI names) — a lexicon of *words* can't express "starts with a slash", so
// offline-classifier.ts keeps those as hardcoded regex, separate from this file. "note" is the
// catch-all fallback and has no trigger words by definition.
export type LexiconCategory = "decision" | "todo" | "preference" | "error" | "question" | "context";

export const LEXICON_CATEGORIES: LexiconCategory[] = ["decision", "todo", "preference", "error", "question", "context"];

export function isLexiconCategory(label: OfflineLabel): label is LexiconCategory {
  return (LEXICON_CATEGORIES as string[]).includes(label);
}

export type Lexicon = Record<LexiconCategory, string[]>;

// The word lists offline-classifier.ts used to hardcode directly. Kept here as the seed a fresh
// lexicon.json is written from, and as the reset target for `smem lexicon reset`.
export const DEFAULT_LEXICON: Lexicon = {
  decision: [
    "decide", "decision", "choose", "chosen", "approved", "reject", "rejected",
    "chốt", "quyết định", "lựa chọn", "chot", "quyet dinh", "lua chon"
  ],
  todo: [
    "todo", "open loop", "follow-up", "followup", "pending", "next step",
    "cần làm", "việc còn", "chưa xong", "bước tiếp", "can lam", "viec con", "chua xong", "buoc tiep"
  ],
  preference: [
    "prefer", "preference", "from now on", "always use", "never use", "convention",
    "từ nay", "quy ước", "ưu tiên", "tu nay", "quy uoc", "uu tien"
  ],
  error: ["error", "failed", "failure", "exception", "stack trace", "crash", "bug", "lỗi", "fail", "hỏng", "loi", "hong"],
  question: [
    "why", "what", "how", "when", "where", "should", "can we",
    "tại sao", "như nào", "làm sao", "có nên", "tai sao", "nhu nao", "lam sao", "co nen"
  ],
  context: [
    "context", "architecture", "design", "rationale", "because", "constraint",
    "ngữ cảnh", "kiến trúc", "thiết kế", "lý do", "ràng buộc", "ngu canh", "kien truc", "thiet ke", "ly do", "rang buoc"
  ]
};

function lexiconPath(home: string): string {
  return join(home, "lexicon.json");
}

/**
 * Load the active lexicon, seeded from DEFAULT_LEXICON. If `lexicon.json` doesn't exist yet
 * (fresh install), the in-memory default is returned without writing anything to disk — a file
 * only appears once the user or the learning loop actually adds a word.
 */
export function loadLexicon(home: string = defaultSmartMemoryHome()): Lexicon {
  const path = lexiconPath(home);
  if (!existsSync(path)) {
    return cloneDefault();
  }
  try {
    return normalizeLexicon(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return cloneDefault();
  }
}

export function saveLexicon(lexicon: Lexicon, home: string = defaultSmartMemoryHome()): void {
  const path = lexiconPath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(lexicon, null, 2)}\n`, "utf8");
}

export function parseLexiconCategory(value: string): LexiconCategory {
  if ((LEXICON_CATEGORIES as string[]).includes(value)) {
    return value as LexiconCategory;
  }
  throw new Error(`"${value}" is not a word-list category. Use one of: ${LEXICON_CATEGORIES.join(", ")}.`);
}

export function addLexiconWord(category: LexiconCategory, word: string, home: string = defaultSmartMemoryHome()): Lexicon {
  const trimmed = word.trim();
  if (!trimmed) {
    throw new Error("Lexicon word must not be empty.");
  }
  const lexicon = loadLexicon(home);
  const words = lexicon[category];
  if (!words.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
    words.push(trimmed);
    saveLexicon(lexicon, home);
  }
  return lexicon;
}

export function removeLexiconWord(category: LexiconCategory, word: string, home: string = defaultSmartMemoryHome()): Lexicon {
  const lexicon = loadLexicon(home);
  lexicon[category] = lexicon[category].filter((existing) => existing.toLowerCase() !== word.trim().toLowerCase());
  saveLexicon(lexicon, home);
  return lexicon;
}

export function resetLexicon(home: string = defaultSmartMemoryHome()): Lexicon {
  const lexicon = cloneDefault();
  saveLexicon(lexicon, home);
  return lexicon;
}

/** Compile one category's active word list into a single word-boundary regex, longest word first. */
export function buildLexiconPattern(lexicon: Lexicon, category: LexiconCategory): RegExp | undefined {
  const words = lexicon[category];
  if (!words || words.length === 0) {
    return undefined;
  }
  const escaped = [...words].map(escapeRegExp).sort((a, b) => b.length - a.length);
  return new RegExp(withUnicodeWordBoundary(escaped.join("|")), "iu");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cloneDefault(): Lexicon {
  const clone = {} as Lexicon;
  for (const category of LEXICON_CATEGORIES) {
    clone[category] = [...DEFAULT_LEXICON[category]];
  }
  return clone;
}

function normalizeLexicon(raw: unknown): Lexicon {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const lexicon = cloneDefault();
  for (const category of LEXICON_CATEGORIES) {
    const value = record[category];
    if (Array.isArray(value)) {
      lexicon[category] = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
    // Category missing from the saved file (older file, or a category added in a later smem
    // version) — keep the default for just that category instead of discarding the whole file.
  }
  return lexicon;
}
