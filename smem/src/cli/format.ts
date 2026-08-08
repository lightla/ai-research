import type { DecisionOverlap } from "../classify/decision-intel";
import type { EntityRecord, MemoryRecord, ProjectRecord } from "../core/schema";
import type { FocusResult, MacroGraph, RelationView } from "../storage/graph-repository";

export function printProject(project: ProjectRecord): string {
  return [
    `Project: ${project.projectName}`,
    `ID: ${project.projectId}`,
    `Root: ${project.rootPath}`,
    `Store: ${project.storePath}`,
    `Last seen: ${project.lastSeenAt}`
  ].join("\n");
}

export function printMemory(memory: MemoryRecord): string {
  const namespace = memory.namespace ? ` [ns:${memory.namespace}]` : "";
  const title = memory.title ? ` ${memory.title}` : "";
  const tags = memory.tags.length > 0 ? ` [${memory.tags.join(", ")}]` : "";
  const status = memory.status !== "active" ? ` (${memory.status})` : "";
  const lines = [`${memory.id} ${memory.type}${status}${namespace}${title}${tags}`, memory.content];

  if (memory.decision) {
    const { chosen, rejectedAlternatives, reasoning } = memory.decision;
    if (chosen) {
      lines.push(`chosen: ${chosen}`);
    }
    if (rejectedAlternatives.length > 0) {
      lines.push(`rejected: ${rejectedAlternatives.join(", ")}`);
    }
    if (reasoning) {
      lines.push(`reason: ${reasoning}`);
    }
  }
  if (memory.supersededBy) {
    lines.push(`superseded by: ${memory.supersededBy}`);
  }

  return lines.join("\n");
}

// Surfaced right after `smem store` creates a decision — a suggestion only, never acted on
// automatically. See MemoryRepository.supersede() for the explicit human confirmation step.
export function printDecisionOverlaps(overlaps: DecisionOverlap[]): string {
  const lines = ["Possible overlap with prior decisions:"];
  for (const overlap of overlaps) {
    lines.push(
      `- ${overlap.memoryId} (${overlap.relationship}, score ${overlap.overlapScore.toFixed(2)}): ${overlap.contentPreview}`
    );
  }
  lines.push("");
  lines.push("If one of these is now outdated: smem supersede <old-id> --by <new-id>");
  return lines.join("\n");
}

export function printEntity(entity: EntityRecord): string {
  const codeRef = entity.codeRef ? ` code_ref=${entity.codeRef}` : "";
  const description = entity.description ? `\n${entity.description}` : "";
  return `${entity.id} ${entity.type} "${entity.name}" (slug: ${entity.slug})${codeRef}${description}`;
}

// `detail` is the Lazy Zoom-In payload — omitted by default so the macro graph view stays a
// glanceable big picture, printed only when the caller (focus/relate) explicitly asks for it.
export function printRelation(relation: RelationView, options: { detail?: boolean } = {}): string {
  const arrow = `[${relation.fromEntity.name}] --${relation.type}--> [${relation.toEntity.name}]`;
  return options.detail && relation.detail ? `${arrow}  (${relation.detail})` : arrow;
}

export function printMacroGraph(graph: MacroGraph): string {
  if (graph.entities.length === 0) {
    return 'No macro entities recorded yet. Add one with: smem entity add --type module --name "..."';
  }

  const lines = ["Entities:", ...graph.entities.map((entity) => `- ${entity.type} ${entity.name} (${entity.slug})`), ""];
  lines.push(graph.relations.length > 0 ? "Relations:" : "Relations: (none yet)");
  for (const relation of graph.relations) {
    lines.push(`- ${printRelation(relation)}`);
  }
  return lines.join("\n").trimEnd();
}

export function printFocus(result: FocusResult): string {
  const lines = [printEntity(result.entity), ""];

  if (result.contains.length > 0) {
    lines.push("Contains:");
    for (const child of result.contains) {
      lines.push(`- ${child.type} ${child.name} (${child.slug})`);
    }
    lines.push("");
  }

  lines.push(result.outgoing.length > 0 || result.incoming.length > 0 ? "Relations:" : "Relations: (none yet)");
  for (const relation of [...result.outgoing, ...result.incoming]) {
    lines.push(`- ${printRelation(relation, { detail: true })}`);
  }
  return lines.join("\n").trimEnd();
}
