import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultSmartMemoryHome } from "../core/paths";

// Command-sequence habit mining — adapted from refs/neural-memory's engine/sequence_mining.py,
// applied to `smem` CLI usage instead of agent tool calls (which arrive in too many different
// per-agent shapes to mine reliably — see cli/index.ts's `postAction` hook comment). Still 0 LLM:
// consecutive command pairs within a time window are counted, and the ratio of a pair's count
// over the total number of pairs observed is the confidence — not a flat count (same reasoning
// as lexicon-learning.ts's ratio threshold).

const DEFAULT_WINDOW_SECONDS = 300; // 5 minutes — commands run further apart than that are
// treated as unrelated, not a "next step" in the same piece of work.
const DEFAULT_MIN_RATIO = 0.1;
const DEFAULT_MIN_COUNT = 3;

// Internal/automatic invocations, not a deliberate user action — mining these would just prove
// "the hook runs a lot", which is already known and not a habit worth surfacing.
const EXCLUDED_COMMANDS = new Set(["hook run"]);

type LoggedCommand = { command: string; timestamp: string };

function logPath(home: string): string {
  return join(home, "command-log.jsonl");
}

export function logCommandInvocation(command: string, home: string = defaultSmartMemoryHome()): void {
  if (EXCLUDED_COMMANDS.has(command)) {
    return;
  }
  const path = logPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const entry: LoggedCommand = { command, timestamp: new Date().toISOString() };
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
}

function readCommandLog(home: string): LoggedCommand[] {
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
        const parsed = JSON.parse(line) as Partial<LoggedCommand>;
        return typeof parsed.command === "string" && typeof parsed.timestamp === "string"
          ? [{ command: parsed.command, timestamp: parsed.timestamp }]
          : [];
      } catch {
        return [];
      }
    });
}

export type HabitCandidate = {
  steps: [string, string];
  count: number;
  totalPairs: number;
  ratio: number;
  avgGapSeconds: number;
};

/**
 * Mine `smem <a>` -> `smem <b>` sequences run within `windowSeconds` of each other, keeping only
 * pairs whose share of all observed consecutive pairs clears `minRatio` (with `minCount` as a
 * floor against tiny samples).
 */
export function mineCommandHabits(
  home: string = defaultSmartMemoryHome(),
  options: { windowSeconds?: number; minRatio?: number; minCount?: number } = {}
): HabitCandidate[] {
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const minRatio = options.minRatio ?? DEFAULT_MIN_RATIO;
  const minCount = options.minCount ?? DEFAULT_MIN_COUNT;

  const entries = readCommandLog(home).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Keyed by JSON-encoded [stepA, stepB] tuple, not a joined string — command names can
  // themselves contain spaces ("lexicon add"), so a plain join would be ambiguous to split back.
  const pairGaps = new Map<string, number[]>();
  let totalPairs = 0;
  for (let i = 0; i < entries.length - 1; i += 1) {
    const a = entries[i]!;
    const b = entries[i + 1]!;
    const gapSeconds = (new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) / 1000;
    if (gapSeconds < 0 || gapSeconds > windowSeconds) {
      continue;
    }
    totalPairs += 1;
    const key = JSON.stringify([a.command, b.command]);
    const gaps = pairGaps.get(key) ?? [];
    gaps.push(gapSeconds);
    pairGaps.set(key, gaps);
  }

  if (totalPairs === 0) {
    return [];
  }

  const candidates: HabitCandidate[] = [];
  for (const [key, gaps] of pairGaps) {
    const [stepA, stepB] = JSON.parse(key) as [string, string];
    const count = gaps.length;
    const ratio = count / totalPairs;
    if (count >= minCount && ratio >= minRatio) {
      candidates.push({
        steps: [stepA, stepB],
        count,
        totalPairs,
        ratio,
        avgGapSeconds: gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
      });
    }
  }

  return candidates.sort((a, b) => b.ratio - a.ratio || b.count - a.count);
}
