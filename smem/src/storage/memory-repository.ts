import { join } from "node:path";
import { createMemoryId } from "../core/ids";
import { defaultSmartMemoryHome } from "../core/paths";
import type { MemoryInput, MemoryRecord, ProjectRecord } from "../core/schema";
import { MemoryInputSchema } from "../core/schema";
import { openMemoryDb, type SqliteDatabase } from "./db";

type MemoryRow = {
  id: string;
  project_id: string;
  scope: "local" | "global";
  type: MemoryRecord["type"];
  title: string | null;
  content: string;
  tags_json: string;
  status: MemoryRecord["status"];
  source_kind: string;
  source_agent: string | null;
  source_json: string;
  created_at: string;
  updated_at: string;
};

export type CreateMemoryOptions = {
  status?: MemoryRecord["status"];
  sourceKind?: string;
  sourceAgent?: string;
  source?: Record<string, unknown>;
};

export class MemoryRepository {
  private readonly db: SqliteDatabase;
  private readonly project: ProjectRecord;
  private readonly scope: "local" | "global";

  constructor(project: ProjectRecord, options: { scope?: "local" | "global"; home?: string } = {}) {
    this.project = project;
    this.scope = options.scope ?? "local";
    const dbPath =
      this.scope === "global"
        ? join(options.home ?? defaultSmartMemoryHome(), "global", "memory.sqlite")
        : join(project.storePath, "memory.sqlite");
    this.db = openMemoryDb(dbPath);
  }

  create(input: MemoryInput, options: CreateMemoryOptions = {}): MemoryRecord {
    const parsed = MemoryInputSchema.parse(input);
    const now = new Date().toISOString();
    const record: MemoryRecord = {
      id: createMemoryId(),
      projectId: this.projectIdForScope(),
      scope: this.scope,
      type: parsed.type,
      ...(parsed.title ? { title: parsed.title } : {}),
      content: parsed.content,
      tags: parsed.tags,
      status: options.status ?? parsed.status,
      sourceKind: options.sourceKind ?? "manual",
      ...(options.sourceAgent ? { sourceAgent: options.sourceAgent } : {}),
      source: options.source ?? {},
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `INSERT INTO memories
          (id, project_id, scope, type, title, content, tags_json, status, source_kind, source_agent, source_json, created_at, updated_at)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.projectId,
        record.scope,
        record.type,
        record.title ?? null,
        record.content,
        JSON.stringify(record.tags),
        record.status,
        record.sourceKind,
        record.sourceAgent ?? null,
        JSON.stringify(record.source),
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  list(limit = 20): MemoryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE project_id = ? AND scope = ?
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(this.projectIdForScope(), this.scope, limit) as MemoryRow[];

    return rows.map((row) => this.mapMemory(row));
  }

  listCandidates(limit = 20): MemoryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE project_id = ? AND scope = ? AND status = 'pending-review'
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(this.projectIdForScope(), this.scope, limit) as MemoryRow[];
    return rows.map((row) => this.mapMemory(row));
  }

  promote(id: string): MemoryRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE memories
         SET status = 'active', updated_at = ?
         WHERE id = ? AND project_id = ? AND scope = ? AND status = 'pending-review'`
      )
      .run(now, id, this.projectIdForScope(), this.scope);

    const memory = this.getByIds([id])[0];
    if (!memory) {
      throw new Error(`Candidate not found: ${id}`);
    }
    return memory;
  }

  reject(id: string): MemoryRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE memories
         SET status = 'rejected', updated_at = ?
         WHERE id = ? AND project_id = ? AND scope = ? AND status = 'pending-review'`
      )
      .run(now, id, this.projectIdForScope(), this.scope);

    const row = this.db
      .prepare("SELECT * FROM memories WHERE id = ? AND project_id = ? AND scope = ?")
      .get(id, this.projectIdForScope(), this.scope) as MemoryRow | undefined;
    if (!row) {
      throw new Error(`Candidate not found: ${id}`);
    }
    return this.mapMemory(row);
  }

  hasSourceEvent(eventId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT id FROM memories
         WHERE project_id = ? AND scope = ? AND source_json LIKE ?
         LIMIT 1`
      )
      .get(this.projectIdForScope(), this.scope, `%${eventId}%`) as { id: string } | undefined;
    return Boolean(row);
  }

  recall(query: string, limit = 10): MemoryRecord[] {
    const normalized = query.trim();
    if (!normalized) {
      return this.list(limit);
    }

    const ftsQuery = buildFtsQuery(normalized);
    if (!ftsQuery) {
      return this.contains(normalized, limit);
    }

    const rows = this.db
      .prepare(
        `SELECT m.*
         FROM memories_fts f
         JOIN memories m ON m.id = f.id
         WHERE memories_fts MATCH ?
           AND m.project_id = ?
           AND m.scope = ?
           AND m.status = 'active'
         ORDER BY
           CASE m.type
             WHEN 'decision' THEN 0
             WHEN 'context' THEN 1
             WHEN 'todo' THEN 2
             ELSE 3
           END,
           m.updated_at DESC
         LIMIT ?`
      )
      .all(ftsQuery, this.projectIdForScope(), this.scope, limit) as MemoryRow[];

    return rows.map((row) => this.mapMemory(row));
  }

  contains(query: string, limit = 10): MemoryRecord[] {
    const normalized = query.trim();
    if (!normalized) {
      return this.list(limit);
    }

    const needle = `%${normalized.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE project_id = ?
           AND scope = ?
           AND status = 'active'
           AND (
             title LIKE ? ESCAPE '\\'
             OR content LIKE ? ESCAPE '\\'
             OR tags_json LIKE ? ESCAPE '\\'
           )
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(this.projectIdForScope(), this.scope, needle, needle, needle, limit) as MemoryRow[];

    return rows.map((row) => this.mapMemory(row));
  }

  getByIds(ids: string[]): MemoryRecord[] {
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE id IN (${placeholders})
           AND project_id = ?
           AND scope = ?
           AND status = 'active'`
      )
      .all(...ids, this.projectIdForScope(), this.scope) as MemoryRow[];
    const byId = new Map(rows.map((row) => [row.id, this.mapMemory(row)]));
    return ids.map((id) => byId.get(id)).filter((memory): memory is MemoryRecord => Boolean(memory));
  }

  context(): string {
    const decisions = this.byType("decision", 5);
    const contexts = this.byType("context", 5);
    const todos = this.byType("todo", 5);

    const lines = [this.scope === "global" ? "Scope: global" : `Project: ${this.project.projectName}`, ""];

    if (decisions.length > 0) {
      lines.push("Core decisions:");
      for (const memory of decisions) {
        lines.push(`- ${this.displayLine(memory)}`);
      }
      lines.push("");
    }

    if (contexts.length > 0) {
      lines.push("Context:");
      for (const memory of contexts) {
        lines.push(`- ${this.displayLine(memory)}`);
      }
      lines.push("");
    }

    if (todos.length > 0) {
      lines.push("Open loops:");
      for (const memory of todos) {
        lines.push(`- ${this.displayLine(memory)}`);
      }
      lines.push("");
    }

    const keys = [...decisions, ...contexts, ...todos]
      .flatMap((memory) => memory.tags)
      .filter((tag, index, tags) => tags.indexOf(tag) === index)
      .slice(0, 8);

    if (keys.length > 0) {
      lines.push("Useful recall keys:");
      for (const key of keys) {
        lines.push(`- ${key}`);
      }
    }

    return lines.join("\n").trimEnd();
  }

  allActive(): MemoryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE project_id = ? AND scope = ? AND status = 'active'
         ORDER BY type ASC, updated_at DESC`
      )
      .all(this.projectIdForScope(), this.scope) as MemoryRow[];
    return rows.map((row) => this.mapMemory(row));
  }

  close(): void {
    this.db.close();
  }

  private byType(type: MemoryRecord["type"], limit: number): MemoryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE project_id = ? AND type = ? AND scope = ? AND status = 'active'
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(this.projectIdForScope(), type, this.scope, limit) as MemoryRow[];
    return rows.map((row) => this.mapMemory(row));
  }

  private mapMemory(row: MemoryRow): MemoryRecord {
    const tags = JSON.parse(row.tags_json) as string[];
    return {
      id: row.id,
      projectId: row.project_id,
      scope: row.scope,
      type: row.type,
      ...(row.title ? { title: row.title } : {}),
      content: row.content,
      tags,
      status: row.status,
      sourceKind: row.source_kind,
      ...(row.source_agent ? { sourceAgent: row.source_agent } : {}),
      source: JSON.parse(row.source_json || "{}") as Record<string, unknown>,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private displayLine(memory: MemoryRecord): string {
    const prefix = memory.title ? `${memory.title}: ` : "";
    return `${prefix}${memory.content}`;
  }

  private projectIdForScope(): string {
    return this.scope === "global" ? "global" : this.project.projectId;
  }
}

function buildFtsQuery(query: string): string {
  return query
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((part) => `"${part.replace(/"/g, '""')}"*`)
    .join(" OR ") ?? "";
}
