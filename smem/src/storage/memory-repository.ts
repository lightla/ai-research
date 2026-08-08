import { join } from "node:path";
import { extractDecisionComponents, findOverlappingDecisions, type DecisionOverlap } from "../classify/decision-intel";
import { createMemoryId } from "../core/ids";
import { defaultSmartMemoryHome } from "../core/paths";
import type { DecisionComponents, MemoryInput, MemoryRecord, ProjectRecord } from "../core/schema";
import { MemoryInputSchema } from "../core/schema";
import { rankMemories, type RecallOptions, type RecallResult } from "../retrieval/retrieval";
import { openMemoryDb, type SqliteDatabase } from "./db";

type MemoryRow = {
  id: string;
  project_id: string;
  scope: "local" | "global";
  type: MemoryRecord["type"];
  namespace: string | null;
  title: string | null;
  content: string;
  tags_json: string;
  status: MemoryRecord["status"];
  source_kind: string;
  source_agent: string | null;
  source_json: string;
  decision_json: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateMemoryOptions = {
  status?: MemoryRecord["status"];
  sourceKind?: string;
  sourceAgent?: string;
  source?: Record<string, unknown>;
};

export type UpdateMemoryInput = {
  type?: MemoryRecord["type"];
  namespace?: string | null;
  title?: string | null;
  content?: string;
  tags?: string[];
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
    // Explicit decision fields (--chosen/--rejected/--reason) win; otherwise try to regex-extract
    // {chosen, rejectedAlternatives, reasoning} from the content itself. See decision-intel.ts —
    // this never calls an LLM and returns null (no field, not an error) when nothing matches.
    const decision =
      parsed.decision ?? (parsed.type === "decision" ? extractDecisionComponents(parsed.content) ?? undefined : undefined);
    const record: MemoryRecord = {
      id: createMemoryId(),
      projectId: this.projectIdForScope(),
      scope: this.scope,
      type: parsed.type,
      namespace: parsed.namespace || "unknown",
      ...(parsed.title ? { title: parsed.title } : {}),
      content: parsed.content,
      tags: parsed.tags,
      status: options.status ?? parsed.status,
      sourceKind: options.sourceKind ?? "manual",
      ...(options.sourceAgent ? { sourceAgent: options.sourceAgent } : {}),
      source: options.source ?? {},
      ...(decision ? { decision } : {}),
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `INSERT INTO memories
          (id, project_id, scope, type, namespace, title, content, tags_json, status, source_kind, source_agent, source_json, decision_json, superseded_by, created_at, updated_at)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.projectId,
        record.scope,
        record.type,
        record.namespace || "unknown",
        record.title ?? null,
        record.content,
        JSON.stringify(record.tags),
        record.status,
        record.sourceKind,
        record.sourceAgent ?? null,
        JSON.stringify(record.source),
        record.decision ? JSON.stringify(record.decision) : null,
        null,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  /**
   * Prior *active* decision memories that a new decision's {chosen, rejectedAlternatives} and
   * tags overlap with, above `threshold`. Call this after `create()` for type="decision" — it
   * never runs automatically and never marks anything itself; `smem store` surfaces the result
   * for a human to act on with `supersede`, matching the "no silent merge" rule the rest of
   * smem's merge/entity flows already follow.
   */
  findDecisionOverlaps(
    components: DecisionComponents,
    tags: string[],
    options: { excludeId?: string; limit?: number; threshold?: number } = {}
  ): DecisionOverlap[] {
    const existing = this.byType("decision", 200).filter((memory) => memory.id !== options.excludeId);
    return findOverlappingDecisions(components, tags, existing, options);
  }

  /**
   * Mark `oldId` as superseded by `newId`. Both must be active memories in this scope. This is
   * the only place `status` becomes "superseded" or `supersededBy` gets set — always an explicit
   * human action (`smem supersede`), never inferred from `findDecisionOverlaps` alone.
   */
  supersede(oldId: string, newId: string): MemoryRecord {
    if (oldId === newId) {
      throw new Error("A memory cannot supersede itself.");
    }
    const old = this.getById(oldId);
    if (!old) {
      throw new Error(`Memory not found: ${oldId}`);
    }
    if (old.status !== "active") {
      throw new Error(`Only active memories can be superseded: ${oldId} (status: ${old.status})`);
    }
    const replacement = this.getById(newId);
    if (!replacement) {
      throw new Error(`Replacement memory not found: ${newId}`);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE memories
         SET status = 'superseded', superseded_by = ?, updated_at = ?
         WHERE id = ? AND project_id = ? AND scope = ? AND status = 'active'`
      )
      .run(newId, now, oldId, this.projectIdForScope(), this.scope);

    return this.getById(oldId)!;
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

  namespaces(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT namespace FROM memories
         WHERE project_id = ? AND scope = ? AND status = 'active' AND namespace IS NOT NULL`
      )
      .all(this.projectIdForScope(), this.scope) as { namespace: string }[];
    return rows.map((r) => r.namespace).sort();
  }

  tags(namespace?: string): string[] {
    let query = `SELECT tags_json FROM memories WHERE project_id = ? AND scope = ? AND status = 'active'`;
    const params = [this.projectIdForScope(), this.scope];
    if (namespace) {
      query += ` AND namespace = ?`;
      params.push(namespace);
    }
    const rows = this.db.prepare(query).all(...params) as { tags_json: string }[];
    const tagsSet = new Set<string>();
    for (const row of rows) {
      try {
        const tags = JSON.parse(row.tags_json) as string[];
        for (const tag of tags) {
          tagsSet.add(tag);
        }
      } catch {}
    }
    return [...tagsSet].sort();
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

  /**
   * For each raw history id in `rawIds`, find the official memory it was promoted/merged into,
   * if any — driven by the `source.mergedFrom` list the web history "promote"/"merge" actions
   * write. A raw item stays visible in history either way; this only tells the UI whether to
   * show "already saved" and which memory to link to. Scans active memories directly (same
   * substring-on-source_json approach as `hasSourceEvent`) rather than a separate index table —
   * this is a local single-user store, not a scale where that scan matters.
   */
  findPromotedRawIds(rawIds: string[]): Record<string, { memoryId: string; title?: string; type: MemoryRecord["type"]; content: string }> {
    if (rawIds.length === 0) {
      return {};
    }

    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE project_id = ? AND scope = ? AND status = 'active' AND source_json LIKE '%mergedFrom%'`)
      .all(this.projectIdForScope(), this.scope) as MemoryRow[];

    const rawIdSet = new Set(rawIds);
    const result: Record<string, { memoryId: string; title?: string; type: MemoryRecord["type"]; content: string }> = {};
    for (const row of rows) {
      const memory = this.mapMemory(row);
      const mergedFrom = memory.source["mergedFrom"];
      if (!Array.isArray(mergedFrom)) {
        continue;
      }
      for (const entry of mergedFrom) {
        const rawId = entry && typeof entry === "object" ? (entry as Record<string, unknown>)["id"] : undefined;
        if (typeof rawId === "string" && rawIdSet.has(rawId) && !result[rawId]) {
          result[rawId] = {
            memoryId: memory.id,
            ...(memory.title ? { title: memory.title } : {}),
            type: memory.type,
            content: memory.content
          };
        }
      }
    }
    return result;
  }

  recall(query: string, limit = 10): MemoryRecord[] {
    return this.retrieve({ query, limit, mode: "fts" }).map((result) => result.memory);
  }

  retrieve(options: RecallOptions): RecallResult[] {
    let memories = this.allRecords();
    if (options.mode === "fts" && options.query.trim()) {
      const ftsQuery = buildFtsQuery(options.query);
      if (ftsQuery) {
        const rows = this.db
          .prepare("SELECT id FROM memories_fts WHERE memories_fts MATCH ?")
          .all(ftsQuery) as Array<{ id: string }>;
        const ids = new Set(rows.map((row) => row.id));
        memories = memories.filter((memory) => ids.has(memory.id));
      }
    }
    return rankMemories(memories, options);
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

  getById(id: string): MemoryRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE id = ? AND project_id = ? AND scope = ?`
      )
      .get(id, this.projectIdForScope(), this.scope) as MemoryRow | undefined;
    return row ? this.mapMemory(row) : null;
  }

  update(id: string, input: UpdateMemoryInput): MemoryRecord {
    const current = this.getById(id);
    if (!current) {
      throw new Error(`Memory not found: ${id}`);
    }
    if (current.status === "archived" || current.status === "rejected") {
      throw new Error(`Cannot edit memory with status ${current.status}: ${id}`);
    }

    const parsed = MemoryInputSchema.parse({
      type: input.type ?? current.type,
      namespace: (input.namespace === undefined ? current.namespace : input.namespace) || "unknown",
      ...(input.title === null ? {} : { title: input.title ?? current.title }),
      content: input.content ?? current.content,
      tags: input.tags ?? current.tags,
      status: current.status
    });
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE memories
         SET type = ?, namespace = ?, title = ?, content = ?, tags_json = ?, updated_at = ?
         WHERE id = ? AND project_id = ? AND scope = ?`
      )
      .run(
        parsed.type,
        parsed.namespace || "unknown",
        parsed.title ?? null,
        parsed.content,
        JSON.stringify(parsed.tags),
        now,
        id,
        this.projectIdForScope(),
        this.scope
      );

    return this.getById(id)!;
  }

  archive(id: string): MemoryRecord {
    const current = this.getById(id);
    if (!current) {
      throw new Error(`Memory not found: ${id}`);
    }
    if (current.status !== "active") {
      throw new Error(`Only active memories can be archived: ${id}`);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE memories
         SET status = 'archived', updated_at = ?
         WHERE id = ? AND project_id = ? AND scope = ? AND status = 'active'`
      )
      .run(now, id, this.projectIdForScope(), this.scope);
    return this.getById(id)!;
  }

  restore(id: string): MemoryRecord {
    const current = this.getById(id);
    if (!current) {
      throw new Error(`Memory not found: ${id}`);
    }
    if (current.status !== "archived") {
      throw new Error(`Only archived memories can be restored: ${id}`);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE memories
         SET status = 'active', updated_at = ?
         WHERE id = ? AND project_id = ? AND scope = ? AND status = 'archived'`
      )
      .run(now, id, this.projectIdForScope(), this.scope);
    return this.getById(id)!;
  }

  remove(id: string): void {
    const current = this.getById(id);
    if (!current) {
      throw new Error(`Memory not found: ${id}`);
    }

    this.db
      .prepare(`DELETE FROM memories WHERE id = ? AND project_id = ? AND scope = ?`)
      .run(id, this.projectIdForScope(), this.scope);
  }

  importRecords(records: MemoryRecord[], onConflict: "skip" | "replace" = "skip"): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;
    const insert = this.db.prepare(
      `INSERT INTO memories
        (id, project_id, scope, type, namespace, title, content, tags_json, status, source_kind, source_agent, source_json, decision_json, superseded_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const replace = this.db.prepare(
      `UPDATE memories
       SET type = ?, namespace = ?, title = ?, content = ?, tags_json = ?, status = ?, source_kind = ?, source_agent = ?, source_json = ?, decision_json = ?, superseded_by = ?, created_at = ?, updated_at = ?
       WHERE id = ? AND project_id = ? AND scope = ?`
    );

    this.db.exec("BEGIN");
    try {
      for (const record of records) {
        const existing = this.getById(record.id);
        if (existing && onConflict === "skip") {
          skipped += 1;
          continue;
        }
        if (existing) {
          replace.run(
            record.type,
            record.namespace ?? null,
            record.title ?? null,
            record.content,
            JSON.stringify(record.tags),
            record.status,
            record.sourceKind,
            record.sourceAgent ?? null,
            JSON.stringify(record.source),
            record.decision ? JSON.stringify(record.decision) : null,
            record.supersededBy ?? null,
            record.createdAt,
            record.updatedAt,
            record.id,
            this.projectIdForScope(),
            this.scope
          );
        } else {
          insert.run(
            record.id,
            this.projectIdForScope(),
            this.scope,
            record.type,
            record.namespace ?? null,
            record.title ?? null,
            record.content,
            JSON.stringify(record.tags),
            record.status,
            record.sourceKind,
            record.sourceAgent ?? null,
            JSON.stringify(record.source),
            record.decision ? JSON.stringify(record.decision) : null,
            record.supersededBy ?? null,
            record.createdAt,
            record.updatedAt
          );
        }
        imported += 1;
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { imported, skipped };
  }

  context(options: { limit?: number; maxChars?: number } = {}): string {
    const selected = rankMemories(this.allActive(), { query: "", limit: options.limit ?? 15 }).map((result) => result.memory);
    const decisions = selected.filter((memory) => memory.type === "decision");
    const contexts = selected.filter((memory) => memory.type === "context");
    const todos = selected.filter((memory) => memory.type === "todo");

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

    const output = lines.join("\n").trimEnd();
    const maxChars = options.maxChars ?? 12_000;
    if (output.length <= maxChars) {
      return output;
    }
    return `${output.slice(0, Math.max(0, maxChars - 80)).trimEnd()}\n\n[Context truncated at ${maxChars} characters.]`;
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

  allRecords(): MemoryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE project_id = ? AND scope = ?
         ORDER BY created_at ASC`
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
      namespace: row.namespace || "unknown",
      ...(row.title ? { title: row.title } : {}),
      content: row.content,
      tags,
      status: row.status,
      sourceKind: row.source_kind,
      ...(row.source_agent ? { sourceAgent: row.source_agent } : {}),
      source: JSON.parse(row.source_json || "{}") as Record<string, unknown>,
      ...(row.decision_json ? { decision: JSON.parse(row.decision_json) as DecisionComponents } : {}),
      ...(row.superseded_by ? { supersededBy: row.superseded_by } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private displayLine(memory: MemoryRecord): string {
    const namespacePrefix = memory.namespace && memory.namespace !== "unknown" ? `[${memory.namespace}] ` : "";
    const prefix = memory.title ? `${memory.title}: ` : "";
    return `${namespacePrefix}${prefix}${memory.content}`;
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
