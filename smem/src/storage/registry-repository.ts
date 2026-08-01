import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createProjectId } from "../core/ids";
import { defaultProjectName, defaultSmartMemoryHome, normalizePath } from "../core/paths";
import { ProjectRecordSchema, type ProjectRecord } from "../core/schema";
import { openRegistryDb, type SqliteDatabase } from "./db";

type ProjectRow = {
  project_id: string;
  project_name: string;
  root_path: string;
  store_path: string;
  created_at: string;
  last_seen_at: string;
};

export class RegistryRepository {
  private readonly db: SqliteDatabase;
  readonly home: string;

  constructor(home = defaultSmartMemoryHome()) {
    this.home = resolve(home);
    mkdirSync(this.home, { recursive: true });
    this.db = openRegistryDb(join(this.home, "registry.sqlite"));
  }

  findByPath(path: string): ProjectRecord | null {
    const rootPath = normalizePath(path);
    const row = this.db
      .prepare("SELECT * FROM projects WHERE root_path = ?")
      .get(rootPath) as ProjectRow | undefined;
    return row ? this.mapProject(row) : null;
  }

  findById(projectId: string): ProjectRecord | null {
    const row = this.db
      .prepare("SELECT * FROM projects WHERE project_id = ?")
      .get(projectId) as ProjectRow | undefined;
    return row ? this.mapProject(row) : null;
  }

  listProjects(): ProjectRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM projects ORDER BY last_seen_at DESC")
      .all() as ProjectRow[];
    return rows.map((row) => this.mapProject(row));
  }

  initProject(options: { cwd: string; name?: string; store?: string }): ProjectRecord {
    const rootPath = normalizePath(options.cwd);
    const existing = this.findByPath(rootPath);
    if (existing) {
      this.touch(existing.projectId, rootPath);
      return existing;
    }

    const projectId = createProjectId();
    const projectName = options.name?.trim() || defaultProjectName(rootPath);
    const storePath = options.store
      ? resolve(options.store)
      : join(this.home, "projects", projectId);
    const now = new Date().toISOString();

    mkdirSync(storePath, { recursive: true });

    this.db
      .prepare(
        `INSERT INTO projects (project_id, project_name, root_path, store_path, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(projectId, projectName, rootPath, storePath, now, now);

    writeProjectMetadata({
      projectId,
      projectName,
      rootPath,
      storePath,
      createdAt: now,
      lastSeenAt: now
    });

    return {
      projectId,
      projectName,
      rootPath,
      storePath,
      createdAt: now,
      lastSeenAt: now
    };
  }

  attachProject(options: { cwd: string; projectId: string }): ProjectRecord {
    const rootPath = normalizePath(options.cwd);
    const project = this.findById(options.projectId);
    if (!project) {
      throw new Error(`Project not found: ${options.projectId}`);
    }
    const existingAtTarget = this.findByPath(rootPath);
    if (existingAtTarget && existingAtTarget.projectId !== project.projectId) {
      throw new Error(
        `Path is already attached to project ${existingAtTarget.projectId}. ` +
          `Run \`smem del --project-id ${existingAtTarget.projectId}\` and type the project id if that project was created by mistake, then retry.`
      );
    }

    const now = new Date().toISOString();

    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("UPDATE projects SET root_path = ?, last_seen_at = ? WHERE project_id = ?")
        .run(rootPath, now, project.projectId);
      writeProjectMetadata({ ...project, rootPath, lastSeenAt: now });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return {
      ...project,
      rootPath,
      lastSeenAt: now
    };
  }

  attachProjectFromPath(options: { cwd: string; fromPath: string }): ProjectRecord {
    const project = this.findByPath(options.fromPath);
    if (!project) {
      throw new Error(`Project not found for path: ${options.fromPath}`);
    }

    return this.attachProject({ cwd: options.cwd, projectId: project.projectId });
  }

  scanStores(options: { store: string; root?: string; name?: string }): { projects: ProjectRecord[]; skipped: string[] } {
    const requested = resolve(options.store);
    const stores = existsSync(join(requested, "memory.sqlite"))
      ? [requested]
      : readdirSync(requested, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && existsSync(join(requested, entry.name, "memory.sqlite")))
          .map((entry) => join(requested, entry.name));
    const projects: ProjectRecord[] = [];
    const skipped: string[] = [];

    for (const storePath of stores) {
      const metadata = readProjectMetadata(storePath);
      const projectId = metadata?.projectId ?? (basename(storePath).startsWith("proj_") ? basename(storePath) : undefined);
      const rootPath = metadata?.rootPath ?? (stores.length === 1 ? options.root : undefined);
      if (!projectId || !rootPath) {
        skipped.push(`${storePath}: missing project metadata; provide --root for a single store`);
        continue;
      }

      const projectName = metadata?.projectName ?? options.name ?? defaultProjectName(rootPath);
      const existing = this.findById(projectId);
      const existingAtRoot = this.findByPath(rootPath);
      if (existingAtRoot && existingAtRoot.projectId !== projectId) {
        skipped.push(`${storePath}: root already belongs to ${existingAtRoot.projectId}`);
        continue;
      }
      const now = new Date().toISOString();
      const project: ProjectRecord = existing
        ? { ...existing, projectName, rootPath: normalizePath(rootPath), storePath, lastSeenAt: now }
        : {
            projectId,
            projectName,
            rootPath: normalizePath(rootPath),
            storePath,
            createdAt: metadata?.createdAt ?? now,
            lastSeenAt: now
          };

      if (existing) {
        this.db
          .prepare(
            `UPDATE projects SET project_name = ?, root_path = ?, store_path = ?, last_seen_at = ? WHERE project_id = ?`
          )
          .run(project.projectName, project.rootPath, project.storePath, project.lastSeenAt, project.projectId);
      } else {
        this.db
          .prepare(
            `INSERT INTO projects (project_id, project_name, root_path, store_path, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(project.projectId, project.projectName, project.rootPath, project.storePath, project.createdAt, project.lastSeenAt);
      }
      writeProjectMetadata(project);
      projects.push(project);
    }

    return { projects, skipped };
  }

  deleteProject(projectId: string): ProjectRecord {
    const project = this.findById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    this.db.prepare("DELETE FROM projects WHERE project_id = ?").run(project.projectId);

    if (existsSync(project.storePath)) {
      rmSync(project.storePath, { recursive: true, force: true });
    }

    return project;
  }

  requireCurrentProject(cwd: string): ProjectRecord {
    const project = this.findByPath(cwd);
    if (!project) {
      throw new Error("No smem project is attached to this path. Run `smem init` first.");
    }
    this.touch(project.projectId, normalizePath(cwd));
    return project;
  }

  close(): void {
    this.db.close();
  }

  private touch(projectId: string, rootPath: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE projects SET last_seen_at = ? WHERE project_id = ?")
      .run(now, projectId);
  }

  private mapProject(row: ProjectRow): ProjectRecord {
    return {
      projectId: row.project_id,
      projectName: row.project_name,
      rootPath: row.root_path,
      storePath: row.store_path,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at
    };
  }
}

function writeProjectMetadata(project: ProjectRecord): void {
  mkdirSync(project.storePath, { recursive: true });
  writeFileSync(join(project.storePath, "project.json"), `${JSON.stringify(project, null, 2)}\n`, "utf8");
}

function readProjectMetadata(storePath: string): ProjectRecord | null {
  const metadataPath = join(storePath, "project.json");
  if (!existsSync(metadataPath)) {
    return null;
  }
  try {
    return ProjectRecordSchema.parse(JSON.parse(readFileSync(metadataPath, "utf8")));
  } catch {
    return null;
  }
}
