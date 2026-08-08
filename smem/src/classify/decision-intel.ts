// Decision intelligence — 100% regex, no LLM. Adapted from refs/neural-memory's
// engine/decision_intel.py, extended bilingual (their version was English-only; smem's real
// usage is heavily Vietnamese) and re-scored to fit smem's data model (no embeddings by
// default — tag Jaccard + token Jaccard on `chosen`, not a vector similarity).
//
// Two independent jobs:
// 1. extractDecisionComponents — pull {chosen, rejectedAlternatives, reasoning} out of free-text
//    content like "chọn PostgreSQL thay vì MongoDB vì cần ACID", so `decision`-type memories get
//    the structured "situational metadata" PURPOSE.md describes without the user filling a form.
// 2. findOverlappingDecisions — does a NEW decision confirm/contradict/evolve a PRIOR one already
//    stored? This is a *suggestion* only (see cli/index.ts's `smem supersede`) — never auto-marks
//    anything, matching the "no silent merge" rule the rest of smem follows.

import { DecisionComponentsSchema, type DecisionComponents, type MemoryRecord } from "../core/schema";

// The "because"/"vì" reasoning clause is its own optional capture group, directly following the
// marker word — same shape as REJECTED_EN/VI below. Earlier drafts used it as a terminator
// *alternative* instead (`(?:\s+because\b|\.|,|$)`), which silently swallowed the marker into
// the overall match with no way to tell it happened, so there was nothing left to re-match
// against for the reasoning text. Keeping the marker directly attached to its capture group
// avoids that trap entirely — and also sidesteps the Unicode-`\b` pitfall (see regex-utils.ts)
// for "vì", since there's no boundary assertion needed right after it anymore.
const CHOSE_OVER_EN =
  /(?:chose|chosen|picked|selected|went with|going with)\s+(.+?)\s+(?:over|instead of|rather than)\s+(.+?)(?:\s+because\s+(.+?))?(?:\.|,|$)/i;
const CHOSE_OVER_VI =
  /(?:chọn|chốt dùng|dùng|xài)\s+(.+?)\s+(?:thay vì|hơn là|hơn|thay cho)\s+(.+?)(?:\s+vì\s+(.+?))?(?:\.|,|$)/i;

const DECIDED_BECAUSE_EN = /(?:decided to|chose|choosing)\s+(.+?)\s+because\s+(.+?)(?:\.|$)/i;
const DECIDED_BECAUSE_VI = /(?:quyết định|chốt)\s+(.+?)\s+vì\s+(.+?)(?:\.|$)/i;

const REJECTED_EN = /(?:rejected|ruled out|dismissed|dropped)\s+(.+?)(?:\s+(?:because|due to|since)\s+(.+?))?(?:\.|,|$)/gi;
const REJECTED_VI = /(?:loại|bỏ qua|không dùng|không chọn)\s+(.+?)(?:\s+(?:vì|do)\s+(.+?))?(?:\.|,|$)/gi;

/**
 * Extract {chosen, rejectedAlternatives, reasoning} from free-text decision content.
 * Returns null if no decision shape is recognized — that's a normal outcome, not an error; the
 * memory is still stored as plain content, just without structured fields.
 */
export function extractDecisionComponents(content: string): DecisionComponents | null {
  const text = content.trim();
  if (!text) {
    return null;
  }

  for (const pattern of [CHOSE_OVER_VI, CHOSE_OVER_EN]) {
    const match = pattern.exec(text);
    if (match) {
      const chosen = match[1]!.trim();
      const rejectedAlternatives = match[2]!
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const reasoning = match[3]?.trim();
      return DecisionComponentsSchema.parse({ chosen, rejectedAlternatives, ...(reasoning ? { reasoning } : {}) });
    }
  }

  for (const pattern of [DECIDED_BECAUSE_VI, DECIDED_BECAUSE_EN]) {
    const match = pattern.exec(text);
    if (match) {
      return DecisionComponentsSchema.parse({ chosen: match[1]!.trim(), reasoning: match[2]!.trim() });
    }
  }

  const rejectedItems: string[] = [];
  const reasoningParts: string[] = [];
  for (const pattern of [REJECTED_VI, REJECTED_EN]) {
    for (const match of text.matchAll(pattern)) {
      rejectedItems.push(match[1]!.trim());
      if (match[2]) {
        reasoningParts.push(match[2]!.trim());
      }
    }
  }
  if (rejectedItems.length > 0) {
    return DecisionComponentsSchema.parse({
      rejectedAlternatives: rejectedItems,
      ...(reasoningParts.length > 0 ? { reasoning: reasoningParts.join("; ") } : {})
    });
  }

  return null;
}

export type DecisionOverlap = {
  memoryId: string;
  contentPreview: string;
  overlapScore: number;
  relationship: "confirms" | "contradicts" | "evolves";
};

/**
 * Score a new decision against prior *active* decision memories. Scoring is 50% tag Jaccard +
 * 50% token Jaccard on `chosen` (no embeddings — smem has no vector index by default). This is
 * an adaptation of decision_intel.py's overlap scoring, not a line-for-line port.
 */
export function findOverlappingDecisions(
  newComponents: DecisionComponents,
  newTags: string[],
  existingDecisions: MemoryRecord[],
  options: { limit?: number; threshold?: number } = {}
): DecisionOverlap[] {
  const threshold = options.threshold ?? 0.3;
  const limit = options.limit ?? 10;
  const newChosen = (newComponents.chosen ?? "").toLowerCase().trim();
  const newRejected = new Set(newComponents.rejectedAlternatives.map((alt) => alt.toLowerCase().trim()));
  const newTagSet = new Set(newTags.map((tag) => tag.toLowerCase()));

  const overlaps: DecisionOverlap[] = [];
  for (const memory of existingDecisions) {
    const old = memory.decision;
    const oldChosen = (old?.chosen ?? "").toLowerCase().trim();
    const oldRejected = new Set((old?.rejectedAlternatives ?? []).map((alt) => alt.toLowerCase().trim()));
    const oldTagSet = new Set(memory.tags.map((tag) => tag.toLowerCase()));

    const tagScore = jaccard(newTagSet, oldTagSet);
    const chosenScore = newChosen && oldChosen ? tokenJaccard(newChosen, oldChosen) : 0;
    const overlapScore = tagScore * 0.5 + chosenScore * 0.5;
    if (overlapScore < threshold) {
      continue;
    }

    let relationship: DecisionOverlap["relationship"] = "evolves";
    if (chosenScore >= 0.5) {
      relationship = "confirms";
    } else if ((newChosen && oldRejected.has(newChosen)) || (oldChosen && newRejected.has(oldChosen))) {
      relationship = "contradicts";
    }

    overlaps.push({
      memoryId: memory.id,
      contentPreview: memory.content.slice(0, 120),
      overlapScore,
      relationship
    });
  }

  return overlaps.sort((a, b) => b.overlapScore - a.overlapScore).slice(0, limit);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function tokenJaccard(a: string, b: string): number {
  const tokensA = new Set(a.match(/[\p{L}\p{N}]+/gu) ?? []);
  const tokensB = new Set(b.match(/[\p{L}\p{N}]+/gu) ?? []);
  return jaccard(tokensA, tokensB);
}
