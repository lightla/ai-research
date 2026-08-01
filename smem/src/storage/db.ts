import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type SqliteDatabase = DatabaseSync;

function migrationRoot(): string {
  const candidates = [
    join(__dirname, "migrations"),
    join(process.cwd(), "dist", "storage", "migrations"),
    join(process.cwd(), "src", "storage", "migrations")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return join(__dirname, "migrations");
}

function applyMigrations(db: SqliteDatabase, group: "registry" | "memory"): void {
  if (group === "memory") {
    for (const file of ["001_init.sql"]) {
      const sql = readFileSync(join(migrationRoot(), group, file), "utf8");
      db.exec(sql);
    }
    ensureMemoryTableCompatible(db);
    for (const file of ["002_fts.sql", "003_embeddings.sql"]) {
      const sql = readFileSync(join(migrationRoot(), group, file), "utf8");
      db.exec(sql);
    }
    ensureMemoryColumns(db);
    return;
  }

  const files = ["001_init.sql"];

  for (const file of files) {
    const sql = readFileSync(join(migrationRoot(), group, file), "utf8");
    db.exec(sql);
  }

}

function ensureMemoryTableCompatible(db: SqliteDatabase): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memories'")
    .get() as { sql: string } | undefined;
  if (!row || row.sql.includes("pending-review")) {
    return;
  }

  db.exec(`
    DROP TRIGGER IF EXISTS memories_ai;
    DROP TRIGGER IF EXISTS memories_ad;
    DROP TRIGGER IF EXISTS memories_au;

    CREATE TABLE memories_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'local' CHECK (scope IN ('local', 'global')),
      type TEXT NOT NULL CHECK (type IN ('decision', 'context', 'todo', 'preference', 'error', 'note')),
      title TEXT,
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending-review', 'rejected', 'superseded', 'archived')),
      source_kind TEXT NOT NULL DEFAULT 'manual',
      source_agent TEXT,
      source_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO memories_new
      (id, project_id, scope, type, title, content, tags_json, status, source_kind, source_agent, source_json, created_at, updated_at)
    SELECT
      id, project_id, scope, type, title, content, tags_json, status, source_kind, source_agent, '{}', created_at, updated_at
    FROM memories;

    DROP TABLE memories;
    ALTER TABLE memories_new RENAME TO memories;

    CREATE INDEX IF NOT EXISTS idx_memories_project_updated ON memories(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
  `);
}

function ensureMemoryColumns(db: SqliteDatabase): void {
  const columns = db.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("source_json")) {
    db.exec("ALTER TABLE memories ADD COLUMN source_json TEXT NOT NULL DEFAULT '{}'");
  }
}

export function openRegistryDb(path: string): SqliteDatabase {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  configureDb(db);
  applyMigrations(db, "registry");
  return db;
}

export function openMemoryDb(path: string): SqliteDatabase {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  configureDb(db);
  applyMigrations(db, "memory");
  return db;
}

function configureDb(db: SqliteDatabase): void {
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);
}
