import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultSmartMemoryHome } from "../core/paths";
import { extractKeywords } from "./keywords";

// Query-topic co-occurrence mining — adapted from refs/neural-memory's
// engine/query_pattern_mining.py ("Recall Pattern Learning" in their docs). Still 0 LLM: this
// only counts which single-word topics tend to appear in consecutive `smem recall` calls within
// a time window, same ratio-based confidence as habit-mining.ts and lexicon-learning.ts.

const DEFAULT_WINDOW_SECONDS = 1800; // 30 minutes — generous vs habit-mining's 5, because
// "look up X, then Y" spans a research task, not a quick two-command action.
const DEFAULT_MIN_RATIO = 0.1;
const DEFAULT_MIN_COUNT = 3;

type LoggedQuery = { topics: string[]; timestamp: string };

function logPath(home: string): string {
  return join(home, "query-log.jsonl");
}

/** Extract single-word topics from a recall query and log them for pattern mining. */
export function logRecallQuery(query: string, home: string = defaultSmartMemoryHome()): void {
  const topics = extractKeywords(query, 2, 6).filter((topic) => !topic.includes(" "));
  if (topics.length === 0) {
    return;
  }
  const path = logPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const entry: LoggedQuery = { topics, timestamp: new Date().toISOString() };
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
}

function readQueryLog(home: string): LoggedQuery[] {
  const path = logPath(home);
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as Partial<LoggedQuery>;
        return Array.isArray(parsed.topics) && typeof parsed.timestamp === "string"
          ? [{ topics: parsed.topics.filter((t): t is string => typeof t === "string"), timestamp: parsed.timestamp }]
          : [];
      } catch {
        return [];
      }
    });
}

export type QueryPatternCandidate = { topics: [string, string]; count: number; totalPairs: number; ratio: number };

/**
 * Mine topic pairs (a, b) where a recall query containing topic `a` was followed, within
 * `windowSeconds`, by a recall query containing topic `b`. Ratio-thresholded like
 * habit-mining.ts, for the same reason: a flat count doesn't say whether a pair is a real
 * pattern or just noise from having a lot of query volume.
 */
export function mineQueryPatterns(
  home: string = defaultSmartMemoryHome(),
  options: { windowSeconds?: number; minRatio?: number; minCount?: number } = {}
): QueryPatternCandidate[] {
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const minRatio = options.minRatio ?? DEFAULT_MIN_RATIO;
  const minCount = options.minCount ?? DEFAULT_MIN_COUNT;

  const entries = readQueryLog(home).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const pairCounts = new Map<string, number>();
  let totalPairs = 0;
  for (let i = 0; i < entries.length - 1; i += 1) {
    const a = entries[i]!;
    const b = entries[i + 1]!;
    const gapSeconds = (new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) / 1000;
    if (gapSeconds < 0 || gapSeconds > windowSeconds) {
      continue;
    }
    for (const topicA of a.topics) {
      for (const topicB of b.topics) {
        if (topicA === topicB) {
          continue;
        }
        totalPairs += 1;
        const key = JSON.stringify([topicA, topicB]);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  if (totalPairs === 0) {
    return [];
  }

  const candidates: QueryPatternCandidate[] = [];
  for (const [key, count] of pairCounts) {
    const ratio = count / totalPairs;
    if (count >= minCount && ratio >= minRatio) {
      const [topicA, topicB] = JSON.parse(key) as [string, string];
      candidates.push({ topics: [topicA, topicB], count, totalPairs, ratio });
    }
  }

  return candidates.sort((a, b) => b.ratio - a.ratio || b.count - a.count);
}

export type RelatedTopicSuggestion = { topic: string; count: number; totalPairs: number; ratio: number };

/**
 * Given the topics of the query just run, suggest topics that tend to follow. Only ever a
 * suggestion printed alongside normal recall results — never expands the search itself.
 */
export function suggestRelatedTopics(
  currentTopics: string[],
  home: string = defaultSmartMemoryHome(),
  options: { windowSeconds?: number; minRatio?: number; minCount?: number } = {}
): RelatedTopicSuggestion[] {
  const currentSet = new Set(currentTopics);
  const best = new Map<string, RelatedTopicSuggestion>();

  for (const pattern of mineQueryPatterns(home, options)) {
    const [from, to] = pattern.topics;
    if (!currentSet.has(from) || currentSet.has(to)) {
      continue;
    }
    const existing = best.get(to);
    if (!existing || pattern.ratio > existing.ratio) {
      best.set(to, { topic: to, count: pattern.count, totalPairs: pattern.totalPairs, ratio: pattern.ratio });
    }
  }

  return [...best.values()].sort((a, b) => b.ratio - a.ratio);
}
