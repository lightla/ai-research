import "server-only";
import { RegistryRepository } from "../../../src/storage/registry-repository";
import { MemoryRepository, type CreateMemoryOptions, type UpdateMemoryInput } from "../../../src/storage/memory-repository";
import type { MemoryInput, MemoryRecord, ProjectRecord } from "../../../src/core/schema";
import {
  deleteRawEventById,
  deleteTranscriptRecordById,
  findTranscriptRecordById,
  normalizeTranscriptRecord,
  searchReferencedTranscripts,
  updateTranscriptRecordContent,
} from "../../../src/raw/raw-reader";

export type { CreateMemoryOptions, MemoryInput, MemoryRecord, ProjectRecord, UpdateMemoryInput };
export type Scope = "local" | "global";

const GLOBAL_PROJECT_STUB: ProjectRecord = {
  projectId: "global",
  projectName: "Global",
  rootPath: "global",
  storePath: "global",
  createdAt: "1970-01-01T00:00:00.000Z",
  lastSeenAt: "1970-01-01T00:00:00.000Z",
};

export function listProjects(): ProjectRecord[] {
  const registry = new RegistryRepository();
  try {
    return registry.listProjects();
  } finally {
    registry.close();
  }
}

export function getProject(projectId: string): ProjectRecord | null {
  const registry = new RegistryRepository();
  try {
    return registry.findById(projectId);
  } finally {
    registry.close();
  }
}

function openRepo(scope: Scope, projectId: string | null): { repo: MemoryRepository; project: ProjectRecord | null } {
  if (scope === "global") {
    return { repo: new MemoryRepository(GLOBAL_PROJECT_STUB, { scope: "global" }), project: null };
  }

  if (!projectId) {
    throw new Error("projectId is required for local scope");
  }
  const project = getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  return { repo: new MemoryRepository(project, { scope: "local" }), project };
}

function withRepo<T>(scope: Scope, projectId: string | null, fn: (repo: MemoryRepository) => T): T {
  const { repo } = openRepo(scope, projectId);
  try {
    return fn(repo);
  } finally {
    repo.close();
  }
}

export function listMemories(scope: Scope, projectId: string | null): MemoryRecord[] {
  return withRepo(scope, projectId, (repo) => repo.allRecords());
}

export function getMemory(scope: Scope, projectId: string | null, id: string): MemoryRecord | null {
  return withRepo(scope, projectId, (repo) => repo.getById(id));
}

export function createMemory(
  scope: Scope,
  projectId: string | null,
  input: MemoryInput,
  options: CreateMemoryOptions = {}
): MemoryRecord {
  return withRepo(scope, projectId, (repo) => repo.create(input, options));
}

export function updateMemory(scope: Scope, projectId: string | null, id: string, input: UpdateMemoryInput): MemoryRecord {
  return withRepo(scope, projectId, (repo) => repo.update(id, input));
}

export function archiveMemory(scope: Scope, projectId: string | null, id: string): MemoryRecord {
  return withRepo(scope, projectId, (repo) => repo.archive(id));
}

export function restoreMemory(scope: Scope, projectId: string | null, id: string): MemoryRecord {
  return withRepo(scope, projectId, (repo) => repo.restore(id));
}

export function removeMemory(scope: Scope, projectId: string | null, id: string): void {
  return withRepo(scope, projectId, (repo) => repo.remove(id));
}

export type HistoryMatch = {
  id: string;
  kind: "event" | "transcript";
  timestamp?: string;
  agent?: string;
  recordKind?: string;
  eventName?: string;
  content: string;
  type?: string;
  namespace?: string | null;
  title?: string | null;
  tags?: string[];
};

// Raw transcript history is scoped by `projectPath` when the caller knows which project it's
// browsing (recorded per-event at capture time); pass none to search the whole home, e.g. for the
// global scope page. An empty query lists everything newest-first (paginated via offset/limit)
// instead of requiring a search term, so the panel can be browsed like a normal list.
export function searchHistory(
  query: string,
  options: { projectPath?: string; limit?: number; offset?: number; agent?: string; kind?: string } = {}
): HistoryMatch[] {
  const records = searchReferencedTranscripts({
    query,
    limit: options.limit ?? 20,
    offset: options.offset ?? 0,
    ...(options.projectPath ? { projectPath: options.projectPath } : {}),
    ...(options.agent ? { agent: options.agent } : {}),
    ...(options.kind ? { kind: options.kind } : {}),
  });

  return records.map((record) => {
    const normalized = normalizeTranscriptRecord(record);
    return {
      id: normalized.id,
      kind: "transcript",
      ...(normalized.timestamp ? { timestamp: normalized.timestamp } : {}),
      agent: normalized.sourceAgent,
      recordKind: normalized.recordKind,
      content: normalized.content ?? "",
      type: normalized.type,
      namespace: normalized.namespace ?? null,
      title: normalized.title ?? null,
      tags: normalized.tags ?? [],
    };
  });
}

export type MergedFromEntry = { id: string; kind: "event" | "transcript" };

export type PromotedInfo = { memoryId: string; title?: string; type: MemoryRecord["type"]; content: string };

/** For a page of history results, which ones already got promoted/merged into an official memory. */
export function findPromotedRawIds(scope: Scope, projectId: string | null, rawIds: string[]): Record<string, PromotedInfo> {
  return withRepo(scope, projectId, (repo) => repo.findPromotedRawIds(rawIds));
}

export function deleteHistoryMatch(kind: "event" | "transcript", id: string): boolean {
  return kind === "event" ? deleteRawEventById(id) : deleteTranscriptRecordById(id);
}

// Content-addressed ids change when content changes (see updateTranscriptRecordContent), so this
// returns the freshly re-read match under its new id rather than just a success flag.
export function updateHistoryContent(
  id: string,
  content: string,
  extra?: { type?: string; namespace?: string | null; title?: string | null; tags?: string[] }
): HistoryMatch | null {
  try {
    const newId = updateTranscriptRecordContent(id, content, undefined, extra);
    if (!newId) {
      return null;
    }

    const record = findTranscriptRecordById(newId);
    if (!record) {
      return null;
    }

    const normalized = normalizeTranscriptRecord(record);
    return {
      id: normalized.id,
      kind: "transcript",
      ...(normalized.timestamp ? { timestamp: normalized.timestamp } : {}),
      agent: normalized.sourceAgent,
      recordKind: normalized.recordKind,
      content: normalized.content ?? "",
      type: normalized.type,
      namespace: normalized.namespace ?? null,
      title: normalized.title ?? null,
      tags: normalized.tags ?? [],
    };
  } catch (error) {
    console.error("Failed to update history content:", error);
    return null;
  }
}
