import type { MemoryRecord } from "../core/schema";

export type RecallStatus = MemoryRecord["status"];

export type RecallOptions = {
  query: string;
  mode?: "contains" | "fts";
  limit?: number;
  type?: MemoryRecord["type"];
  tag?: string;
  topic?: string;
  status?: RecallStatus;
};

export type RetrievalReason = {
  score: number;
  matches: string[];
  adjustments: string[];
};

export type RecallResult = {
  memory: MemoryRecord;
  reason: RetrievalReason;
};

const TYPE_PRIORITY: Record<MemoryRecord["type"], number> = {
  decision: 0.8,
  context: 0.6,
  todo: 0.5,
  preference: 0.4,
  error: 0.3,
  note: 0.1
};

export function rankMemories(memories: MemoryRecord[], options: RecallOptions): RecallResult[] {
  const query = options.query.trim().toLowerCase();
  const terms = tokenize(query);
  const tag = options.tag?.trim().toLowerCase();
  const topic = options.topic?.trim().toLowerCase();
  const status = options.status ?? "active";

  return memories
    .filter((memory) => memory.status === status)
    .filter((memory) => !options.type || memory.type === options.type)
    .filter((memory) => !tag || memory.tags.some((value) => value.toLowerCase() === tag))
    .filter((memory) => !topic || memoryMatchesTopic(memory, topic))
    .map((memory) => scoreMemory(memory, query, terms, options.mode ?? "fts"))
    .filter((result) => terms.length === 0 || result.reason.matches.length > 0)
    .sort((left, right) => {
      if (right.reason.score !== left.reason.score) {
        return right.reason.score - left.reason.score;
      }
      if (right.memory.updatedAt !== left.memory.updatedAt) {
        return right.memory.updatedAt.localeCompare(left.memory.updatedAt);
      }
      return left.memory.id.localeCompare(right.memory.id);
    })
    .slice(0, options.limit ?? 10);
}

function scoreMemory(memory: MemoryRecord, query: string, terms: string[], mode: "contains" | "fts"): RecallResult {
  const title = memory.title?.toLowerCase() ?? "";
  const content = memory.content.toLowerCase();
  const tags = memory.tags.map((tag) => tag.toLowerCase());
  const matches: string[] = [];
  let score = TYPE_PRIORITY[memory.type];

  if (mode === "contains" && query && !title.includes(query) && !content.includes(query) && !tags.some((tag) => tag.includes(query))) {
    return { memory, reason: { score, matches: [], adjustments: [] } };
  }

  if (query && content.includes(query)) {
    score += 5;
    matches.push("exact-content");
  }
  if (query && title.includes(query)) {
    score += 6;
    matches.push("exact-title");
  }

  for (const term of terms) {
    if (title.includes(term)) {
      score += 3;
      matches.push(`title:${term}`);
    }
    if (content.includes(term)) {
      score += 2;
      matches.push(`content:${term}`);
    }
    if (tags.some((tag) => tag.includes(term))) {
      score += 2.5;
      matches.push(`tag:${term}`);
    }
  }

  const ageDays = Math.max(0, (Date.now() - Date.parse(memory.updatedAt)) / 86_400_000);
  const recency = Number.isFinite(ageDays) ? Math.max(0, 0.5 - ageDays / 365) : 0;
  score += recency;
  const adjustments = [`type:${memory.type}+${TYPE_PRIORITY[memory.type].toFixed(1)}`];
  if (recency > 0) {
    adjustments.push(`recency+${recency.toFixed(2)}`);
  }
  if (memory.sourceKind === "manual" || memory.sourceKind === "promoted") {
    score += 0.2;
    adjustments.push("trusted-source+0.2");
  }

  return { memory, reason: { score, matches: unique(matches), adjustments } };
}

function memoryMatchesTopic(memory: MemoryRecord, topic: string): boolean {
  if (memory.tags.some((tag) => tag.toLowerCase().includes(topic))) {
    return true;
  }
  const classification = memory.source["classification"];
  if (!classification || typeof classification !== "object" || Array.isArray(classification)) {
    return false;
  }
  const topics = (classification as Record<string, unknown>)["topics"];
  return Array.isArray(topics) && topics.some((value) => typeof value === "string" && value.toLowerCase().includes(topic));
}

function tokenize(value: string): string[] {
  return value.match(/[\p{L}\p{N}_-]+/gu)?.map((term) => term.toLowerCase()).filter((term) => term.length > 1) ?? [];
}

function unique(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}
