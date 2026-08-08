import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MemoryRecord } from "../core/schema";
import { defaultSmartMemoryHome } from "../core/paths";
import { extractKeywords } from "./keywords";
import { buildLexiconPattern, isLexiconCategory, loadLexicon, LEXICON_CATEGORIES, type LexiconCategory } from "./lexicon";

// How the lexicon "learns the user's habit" without an LLM: it never guesses meaning from a
// single message, it only counts. Every time a human PROMOTES a memory whose type has no
// matching lexicon word anywhere in its content, that promotion is a signal the user's own
// phrasing means something the current word list doesn't know yet. Once a word shows up in
// enough independently-promoted memories of the same type, it's a strong enough signal to
// surface as a suggestion — the user still confirms before it becomes an active trigger word
// (same "no silent merge" rule the rest of smem already follows for memory/entity merges).
//
// Threshold is a RATIO (word count / total confirmations of that category), not a flat count —
// adapted from refs/neural-memory's sequence_mining.py, which scores habit candidates as
// `frequency / total_sessions` rather than a raw count. A flat count of 3 is a strong signal out
// of 5 total decisions confirmed, but noise out of 500 — the ratio is what actually says
// "consistently shows up", not just "showed up a few times because there's a lot of volume".

const DEFAULT_MIN_RATIO = 0.15;
const DEFAULT_MIN_COUNT = 3;

type CategoryBucket = {
  /** Confirmations of this category overall, whether or not the lexicon already explained them. */
  total: number;
  /** word -> count of confirmations the current lexicon did NOT explain, containing that word. */
  words: Record<string, number>;
};

type CandidateCounts = Partial<Record<LexiconCategory, CategoryBucket>>;

function candidatesPath(home: string): string {
  return join(home, "lexicon-candidates.json");
}

function loadCandidates(home: string): CandidateCounts {
  const path = candidatesPath(home);
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? normalizeCandidates(parsed) : {};
  } catch {
    return {};
  }
}

function normalizeCandidates(raw: Record<string, unknown>): CandidateCounts {
  const counts: CandidateCounts = {};
  for (const category of LEXICON_CATEGORIES) {
    const bucket = raw[category];
    if (
      bucket &&
      typeof bucket === "object" &&
      typeof (bucket as Record<string, unknown>).total === "number" &&
      typeof (bucket as Record<string, unknown>).words === "object"
    ) {
      counts[category] = bucket as CategoryBucket;
    }
    // Older/corrupt shape for this category — starts fresh rather than crashing on it. Losing a
    // few in-flight counters is low-stakes; they just take a bit longer to resurface.
  }
  return counts;
}

function saveCandidates(counts: CandidateCounts, home: string): void {
  const path = candidatesPath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(counts, null, 2)}\n`, "utf8");
}

/**
 * Call this whenever a human confirms a memory's type directly — either `smem store --type X`
 * (explicit from the start) or `smem promote` (confirming a pending-review candidate). No-op for
 * types without a word-list category (e.g. "todo" is one; "note" is not — there is nothing to
 * learn for a catch-all bucket).
 */
export function recordPromotionSignal(memory: MemoryRecord, home: string = defaultSmartMemoryHome()): void {
  if (!isLexiconCategory(memory.type)) {
    return;
  }

  const counts = loadCandidates(home);
  const bucket = counts[memory.type] ?? { total: 0, words: {} };
  bucket.total += 1;

  const lexicon = loadLexicon(home);
  const pattern = buildLexiconPattern(lexicon, memory.type);
  if (!pattern || !pattern.test(memory.content)) {
    for (const keyword of extractKeywords(memory.content, 2, 6)) {
      if (keyword.includes(" ")) {
        continue; // learn single trigger words first; bigrams are noisier signal for this
      }
      bucket.words[keyword] = (bucket.words[keyword] ?? 0) + 1;
    }
  }

  counts[memory.type] = bucket;
  saveCandidates(counts, home);
}

export type LexiconSuggestion = { category: LexiconCategory; word: string; count: number; total: number; ratio: number };

/**
 * Candidate words whose share of that category's confirmations has crossed `minRatio`, with at
 * least `minCount` occurrences (a floor so 1-out-of-2 at 50% doesn't qualify on ratio alone).
 */
export function listLexiconSuggestions(
  home: string = defaultSmartMemoryHome(),
  options: { minRatio?: number; minCount?: number } = {}
): LexiconSuggestion[] {
  const minRatio = options.minRatio ?? DEFAULT_MIN_RATIO;
  const minCount = options.minCount ?? DEFAULT_MIN_COUNT;
  const counts = loadCandidates(home);
  const suggestions: LexiconSuggestion[] = [];

  for (const category of LEXICON_CATEGORIES) {
    const bucket = counts[category];
    if (!bucket || bucket.total === 0) {
      continue;
    }
    for (const [word, count] of Object.entries(bucket.words)) {
      const ratio = count / bucket.total;
      if (count >= minCount && ratio >= minRatio) {
        suggestions.push({ category, word, count, total: bucket.total, ratio });
      }
    }
  }

  return suggestions.sort((a, b) => b.ratio - a.ratio || b.count - a.count);
}

/** Clear a suggestion's counter without adding it to the lexicon (the "reject" side of review). */
export function dismissLexiconSuggestion(category: LexiconCategory, word: string, home: string = defaultSmartMemoryHome()): void {
  const counts = loadCandidates(home);
  const bucket = counts[category];
  if (bucket) {
    delete bucket.words[word];
    saveCandidates(counts, home);
  }
}
