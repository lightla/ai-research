import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { RegistryRepository } from "../src/storage/registry-repository";
import { GraphRepository } from "../src/storage/graph-repository";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function setupProject() {
  const home = mkdtempSync(join(tmpdir(), "smem-test-"));
  const projectDir = mkdtempSync(join(tmpdir(), "smem-project-"));
  tempDirs.push(home, projectDir);

  const registry = new RegistryRepository(home);
  const project = registry.initProject({ cwd: projectDir, name: "demo" });
  registry.close();
  return project;
}

test("creates macro entities and relates them at the module level", () => {
  const project = setupProject();
  const graph = new GraphRepository(project);

  const user = graph.upsertEntity({ type: "module", name: "User" });
  const order = graph.upsertEntity({ type: "module", name: "Order" });
  expect(user.slug).toBe("user");
  expect(order.slug).toBe("order");

  graph.createRelation({
    fromEntity: "User",
    toEntity: "Order",
    type: "COMMUNICATES_VIA",
    detail: "Kafka topic order.created (event streaming)"
  });

  const macro = graph.macroGraph();
  expect(macro.entities.map((entity) => entity.slug).sort()).toEqual(["order", "user"]);
  expect(macro.relations).toHaveLength(1);
  expect(macro.relations[0]?.type).toBe("COMMUNICATES_VIA");
  // Big-picture view carries the relation but the detail is a zoom-in concern, not lost data —
  // `focus` (tested below) is what surfaces it.
  expect(macro.relations[0]?.detail).toBe("Kafka topic order.created (event streaming)");

  graph.close();
});

test("upsertEntity is idempotent by slug and rejects a type change", () => {
  const project = setupProject();
  const graph = new GraphRepository(project);

  const first = graph.upsertEntity({ type: "module", name: "AuthService", description: "handles login" });
  const second = graph.upsertEntity({ type: "module", name: "AuthService", codeRef: "src/auth/" });

  expect(second.id).toBe(first.id);
  expect(second.description).toBe("handles login");
  expect(second.codeRef).toBe("src/auth/");

  expect(() => graph.upsertEntity({ type: "domain_object", name: "AuthService" })).toThrow(/already exists as type/);

  graph.close();
});

test("createRelation refuses to guess a missing entity's type", () => {
  const project = setupProject();
  const graph = new GraphRepository(project);
  graph.upsertEntity({ type: "module", name: "User" });

  expect(() =>
    graph.createRelation({ fromEntity: "User", toEntity: "GhostModule", type: "DEPENDS_ON" })
  ).toThrow(/Entity not found: "GhostModule"/);

  graph.close();
});

test("focus zooms into one entity: full relation detail plus what it contains", () => {
  const project = setupProject();
  const graph = new GraphRepository(project);

  const order = graph.upsertEntity({ type: "module", name: "Order" });
  const orderItem = graph.upsertEntity({ type: "domain_object", name: "OrderItem" });
  const user = graph.upsertEntity({ type: "module", name: "User" });
  graph.createRelation({ fromEntity: "Order", toEntity: "OrderItem", type: "CONTAINS" });
  graph.createRelation({ fromEntity: "User", toEntity: "Order", type: "COMMUNICATES_VIA", detail: "event streaming" });

  const result = graph.focus("order");
  expect(result?.entity.id).toBe(order.id);
  expect(result?.contains.map((entity) => entity.id)).toEqual([orderItem.id]);
  expect(result?.incoming[0]?.fromEntity.id).toBe(user.id);
  expect(result?.incoming[0]?.detail).toBe("event streaming");

  expect(graph.focus("does-not-exist")).toBeNull();

  graph.close();
});

test("relate is idempotent and merges a later detail into the same relation row", () => {
  const project = setupProject();
  const graph = new GraphRepository(project);
  graph.upsertEntity({ type: "module", name: "User" });
  graph.upsertEntity({ type: "module", name: "Order" });

  const first = graph.createRelation({ fromEntity: "User", toEntity: "Order", type: "COMMUNICATES_VIA" });
  const second = graph.createRelation({
    fromEntity: "User",
    toEntity: "Order",
    type: "COMMUNICATES_VIA",
    detail: "Kafka topic order.created"
  });

  expect(second.id).toBe(first.id);
  expect(graph.listRelations()).toHaveLength(1);
  expect(graph.listRelations()[0]?.detail).toBe("Kafka topic order.created");

  graph.close();
});
