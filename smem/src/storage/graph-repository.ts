import { join } from "node:path";
import { createEntityId, createRelationId } from "../core/ids";
import { defaultSmartMemoryHome } from "../core/paths";
import {
  EntityInputSchema,
  RelationInputSchema,
  type EntityInput,
  type EntityRecord,
  type EntityType,
  type ProjectRecord,
  type RelationInput,
  type RelationRecord,
  type RelationType
} from "../core/schema";
import { slugify } from "../core/slug";
import { openMemoryDb, type SqliteDatabase } from "./db";

type EntityRow = {
  id: string;
  project_id: string;
  scope: "local" | "global";
  type: EntityType;
  name: string;
  slug: string;
  description: string | null;
  code_ref: string | null;
  created_at: string;
  updated_at: string;
};

type RelationRow = {
  id: string;
  project_id: string;
  scope: "local" | "global";
  from_entity_id: string;
  to_entity_id: string;
  relation_type: RelationType;
  detail: string | null;
  created_at: string;
};

// Big Picture First: module/decision/constraint only, no `detail`, so the whole graph fits in a
// few dozen lines. Lazy Zoom-In (see `focus`) is where detail and domain_object children show up.
const MACRO_ENTITY_TYPES: EntityType[] = ["module", "decision", "constraint"];

export type RelationView = RelationRecord & { fromEntity: EntityRecord; toEntity: EntityRecord };

export type MacroGraph = {
  entities: EntityRecord[];
  relations: RelationView[];
};

export type FocusResult = {
  entity: EntityRecord;
  outgoing: RelationView[];
  incoming: RelationView[];
  contains: EntityRecord[];
};

export class GraphRepository {
  private readonly db: SqliteDatabase;
  private readonly project: ProjectRecord;
  private readonly scope: "local" | "global";

  constructor(project: ProjectRecord, options: { scope?: "local" | "global"; home?: string } = {}) {
    this.project = project;
    this.scope = options.scope ?? "local";
    // Entities/relations live in the same memory.sqlite as memory records — one canonical store
    // per project/scope, not a second graph database to keep in sync.
    const dbPath =
      this.scope === "global"
        ? join(options.home ?? defaultSmartMemoryHome(), "global", "memory.sqlite")
        : join(project.storePath, "memory.sqlite");
    this.db = openMemoryDb(dbPath);
  }

  /**
   * Create an entity, or update description/codeRef if one with the same slug already exists.
   * Idempotent by design: an agent re-declaring "AuthService" across multiple `smem store` calls
   * must resolve to the same node, not fork a near-duplicate.
   */
  upsertEntity(input: EntityInput): EntityRecord {
    const parsed = EntityInputSchema.parse(input);
    const slug = slugify(parsed.name);
    const existing = this.getBySlug(slug);
    const now = new Date().toISOString();

    if (existing) {
      if (existing.type !== parsed.type) {
        throw new Error(
          `Entity "${parsed.name}" already exists as type "${existing.type}" (slug: ${slug}); cannot redeclare it as "${parsed.type}".`
        );
      }
      this.db
        .prepare(
          `UPDATE entities
           SET description = coalesce(?, description), code_ref = coalesce(?, code_ref), updated_at = ?
           WHERE id = ?`
        )
        .run(parsed.description ?? null, parsed.codeRef ?? null, now, existing.id);
      return this.getBySlug(slug)!;
    }

    const record: EntityRecord = {
      id: createEntityId(),
      projectId: this.projectIdForScope(),
      scope: this.scope,
      type: parsed.type,
      name: parsed.name,
      slug,
      ...(parsed.description ? { description: parsed.description } : {}),
      ...(parsed.codeRef ? { codeRef: parsed.codeRef } : {}),
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `INSERT INTO entities (id, project_id, scope, type, name, slug, description, code_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.projectId,
        record.scope,
        record.type,
        record.name,
        record.slug,
        record.description ?? null,
        record.codeRef ?? null,
        record.createdAt,
        record.updatedAt
      );

    return record;
  }

  getBySlug(slug: string): EntityRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM entities WHERE project_id = ? AND scope = ? AND slug = ?`)
      .get(this.projectIdForScope(), this.scope, slug) as EntityRow | undefined;
    return row ? this.mapEntity(row) : null;
  }

  listEntities(options: { type?: EntityType } = {}): EntityRecord[] {
    const rows = options.type
      ? this.db
          .prepare(`SELECT * FROM entities WHERE project_id = ? AND scope = ? AND type = ? ORDER BY name ASC`)
          .all(this.projectIdForScope(), this.scope, options.type)
      : this.db
          .prepare(`SELECT * FROM entities WHERE project_id = ? AND scope = ? ORDER BY name ASC`)
          .all(this.projectIdForScope(), this.scope);
    return (rows as EntityRow[]).map((row) => this.mapEntity(row));
  }

  /**
   * Record a typed relation between two *existing* entities. Entities are resolved strictly —
   * a missing entity is a clear error, not an auto-created guess, because only the caller knows
   * whether "Order" should be a module or a domain_object.
   */
  createRelation(input: RelationInput): RelationRecord {
    const parsed = RelationInputSchema.parse(input);
    const from = this.resolveEntity(parsed.fromEntity);
    const to = this.resolveEntity(parsed.toEntity);
    if (from.id === to.id) {
      throw new Error(`Cannot relate "${from.name}" to itself.`);
    }

    const existing = this.db
      .prepare(
        `SELECT * FROM relations
         WHERE project_id = ? AND scope = ? AND from_entity_id = ? AND to_entity_id = ? AND relation_type = ?`
      )
      .get(this.projectIdForScope(), this.scope, from.id, to.id, parsed.type) as RelationRow | undefined;

    if (existing) {
      if (parsed.detail && parsed.detail !== existing.detail) {
        this.db.prepare(`UPDATE relations SET detail = ? WHERE id = ?`).run(parsed.detail, existing.id);
        return this.mapRelation({ ...existing, detail: parsed.detail });
      }
      return this.mapRelation(existing);
    }

    const now = new Date().toISOString();
    const record: RelationRecord = {
      id: createRelationId(),
      projectId: this.projectIdForScope(),
      scope: this.scope,
      fromEntityId: from.id,
      toEntityId: to.id,
      type: parsed.type,
      ...(parsed.detail ? { detail: parsed.detail } : {}),
      createdAt: now
    };

    this.db
      .prepare(
        `INSERT INTO relations (id, project_id, scope, from_entity_id, to_entity_id, relation_type, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.projectId,
        record.scope,
        record.fromEntityId,
        record.toEntityId,
        record.type,
        record.detail ?? null,
        record.createdAt
      );

    return record;
  }

  listRelations(options: { entityId?: string } = {}): RelationView[] {
    const rows = options.entityId
      ? this.db
          .prepare(
            `SELECT * FROM relations
             WHERE project_id = ? AND scope = ? AND (from_entity_id = ? OR to_entity_id = ?)
             ORDER BY created_at ASC`
          )
          .all(this.projectIdForScope(), this.scope, options.entityId, options.entityId)
      : this.db
          .prepare(`SELECT * FROM relations WHERE project_id = ? AND scope = ? ORDER BY created_at ASC`)
          .all(this.projectIdForScope(), this.scope);
    return (rows as RelationRow[]).map((row) => this.mapRelationView(row));
  }

  /** Big Picture First: modules/decisions/constraints and the relations strictly between them. */
  macroGraph(): MacroGraph {
    const entities = this.listEntities().filter((entity) => MACRO_ENTITY_TYPES.includes(entity.type));
    const macroIds = new Set(entities.map((entity) => entity.id));
    const relations = this.listRelations().filter(
      (relation) => macroIds.has(relation.fromEntityId) && macroIds.has(relation.toEntityId)
    );
    return { entities, relations };
  }

  /** Lazy Zoom-In: one entity's full relation detail plus what it directly CONTAINS. */
  focus(slug: string): FocusResult | null {
    const entity = this.getBySlug(slugify(slug));
    if (!entity) {
      return null;
    }
    const all = this.listRelations({ entityId: entity.id });
    const outgoing = all.filter((relation) => relation.fromEntityId === entity.id);
    const incoming = all.filter((relation) => relation.toEntityId === entity.id);
    const contains = outgoing.filter((relation) => relation.type === "CONTAINS").map((relation) => relation.toEntity);
    return { entity, outgoing, incoming, contains };
  }

  close(): void {
    this.db.close();
  }

  private resolveEntity(nameOrSlug: string): EntityRecord {
    const entity = this.getBySlug(slugify(nameOrSlug));
    if (!entity) {
      throw new Error(
        `Entity not found: "${nameOrSlug}". Create it first with: smem entity add --type <module|domain_object|decision|constraint> --name "${nameOrSlug}"`
      );
    }
    return entity;
  }

  private getById(id: string): EntityRecord | null {
    const row = this.db.prepare(`SELECT * FROM entities WHERE id = ?`).get(id) as EntityRow | undefined;
    return row ? this.mapEntity(row) : null;
  }

  private mapEntity(row: EntityRow): EntityRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      scope: row.scope,
      type: row.type,
      name: row.name,
      slug: row.slug,
      ...(row.description ? { description: row.description } : {}),
      ...(row.code_ref ? { codeRef: row.code_ref } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapRelation(row: RelationRow): RelationRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      scope: row.scope,
      fromEntityId: row.from_entity_id,
      toEntityId: row.to_entity_id,
      type: row.relation_type,
      ...(row.detail ? { detail: row.detail } : {}),
      createdAt: row.created_at
    };
  }

  private mapRelationView(row: RelationRow): RelationView {
    const fromEntity = this.getById(row.from_entity_id);
    const toEntity = this.getById(row.to_entity_id);
    if (!fromEntity || !toEntity) {
      throw new Error(`Relation ${row.id} references a missing entity.`);
    }
    return { ...this.mapRelation(row), fromEntity, toEntity };
  }

  private projectIdForScope(): string {
    return this.scope === "global" ? "global" : this.project.projectId;
  }
}
