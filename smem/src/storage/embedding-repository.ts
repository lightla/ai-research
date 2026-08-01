import { createHash } from "node:crypto";
import { join } from "node:path";
import { defaultSmartMemoryHome } from "../core/paths";
import type { MemoryRecord, ProjectRecord } from "../core/schema";
import type { EmbeddingClient } from "../embedding/embedding-client";
import { cosineSimilarity } from "../embedding/vector";
import { openMemoryDb, type SqliteDatabase } from "./db";

type EmbeddingRow = {
  memory_id: string;
  project_id: string;
  scope: "local" | "global";
  provider: string;
  model: string;
  dimensions: number;
  vector_json: string;
  content_hash: string;
  updated_at: string;
};

export type SemanticResult = {
  memoryId: string;
  score: number;
};

export class EmbeddingRepository {
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

  async index(memories: MemoryRecord[], client: EmbeddingClient): Promise<{ indexed: number; skipped: number }> {
    const candidates = memories.filter((memory) => {
      const existing = this.find(memory.id);
      return !existing || existing.content_hash !== contentHash(memory) || existing.model !== client.model;
    });

    if (candidates.length === 0) {
      return { indexed: 0, skipped: memories.length };
    }

    let indexed = 0;
    const batchSize = 64;

    for (let offset = 0; offset < candidates.length; offset += batchSize) {
      const batch = candidates.slice(offset, offset + batchSize);
      const vectors = await client.embed(batch.map(memoryTextForEmbedding));
      for (let index = 0; index < batch.length; index += 1) {
        const memory = batch[index];
        const vector = vectors[index];
        if (!memory || !vector) {
          continue;
        }
        this.upsert(memory, client, vector);
        indexed += 1;
      }
    }

    return { indexed, skipped: memories.length - indexed };
  }

  async search(query: string, client: EmbeddingClient, limit: number): Promise<SemanticResult[]> {
    const [queryVector] = await client.embed([query]);
    if (!queryVector) {
      return [];
    }

    const rows = this.db
      .prepare(
        `SELECT *
         FROM memory_embeddings
         WHERE project_id = ? AND scope = ? AND provider = ? AND model = ?`
      )
      .all(this.projectIdForScope(), this.scope, client.provider, client.model) as EmbeddingRow[];

    return rows
      .map((row) => ({
        memoryId: row.memory_id,
        score: cosineSimilarity(queryVector, JSON.parse(row.vector_json) as number[])
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  close(): void {
    this.db.close();
  }

  private find(memoryId: string): EmbeddingRow | null {
    const row = this.db
      .prepare("SELECT * FROM memory_embeddings WHERE memory_id = ?")
      .get(memoryId) as EmbeddingRow | undefined;
    return row ?? null;
  }

  private upsert(memory: MemoryRecord, client: EmbeddingClient, vector: number[]): void {
    this.db
      .prepare(
        `INSERT INTO memory_embeddings
          (memory_id, project_id, scope, provider, model, dimensions, vector_json, content_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(memory_id) DO UPDATE SET
           provider = excluded.provider,
           model = excluded.model,
           dimensions = excluded.dimensions,
           vector_json = excluded.vector_json,
           content_hash = excluded.content_hash,
           updated_at = excluded.updated_at`
      )
      .run(
        memory.id,
        this.projectIdForScope(),
        this.scope,
        client.provider,
        client.model,
        vector.length,
        JSON.stringify(vector),
        contentHash(memory),
        new Date().toISOString()
      );
  }

  private projectIdForScope(): string {
    return this.scope === "global" ? "global" : this.project.projectId;
  }
}

export function memoryTextForEmbedding(memory: MemoryRecord): string {
  return [memory.type, memory.title ?? "", memory.content, memory.tags.join(" ")].filter(Boolean).join("\n");
}

function contentHash(memory: MemoryRecord): string {
  return createHash("sha256").update(memoryTextForEmbedding(memory)).digest("hex");
}
