import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryRecord, ProjectRecord } from "../core/schema";

export function renderMarkdown(project: ProjectRecord, memories: MemoryRecord[]): string {
  const lines = [`# ${project.projectName}`, "", `Project ID: \`${project.projectId}\``, ""];
  const groups = groupByType(memories);

  for (const type of ["decision", "context", "todo", "preference", "error", "note"] as const) {
    const group = groups.get(type) ?? [];
    if (group.length === 0) {
      continue;
    }

    lines.push(`## ${titleForType(type)}`, "");
    for (const memory of group) {
      lines.push(`### ${memory.title ?? memory.id}`, "");
      lines.push(memory.content, "");
      if (memory.tags.length > 0) {
        lines.push(`Tags: ${memory.tags.map((tag) => `\`${tag}\``).join(", ")}`, "");
      }
      lines.push(`Updated: ${memory.updatedAt}`, "");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function writeMarkdownRender(project: ProjectRecord, memories: MemoryRecord[]): string {
  const renderedDir = join(project.storePath, "rendered");
  mkdirSync(renderedDir, { recursive: true });

  const indexPath = join(renderedDir, "index.md");
  writeFileSync(indexPath, renderMarkdown(project, memories), "utf8");
  return indexPath;
}

function groupByType(memories: MemoryRecord[]): Map<MemoryRecord["type"], MemoryRecord[]> {
  const groups = new Map<MemoryRecord["type"], MemoryRecord[]>();
  for (const memory of memories) {
    const existing = groups.get(memory.type) ?? [];
    existing.push(memory);
    groups.set(memory.type, existing);
  }
  return groups;
}

function titleForType(type: MemoryRecord["type"]): string {
  switch (type) {
    case "decision":
      return "Decisions";
    case "context":
      return "Context";
    case "todo":
      return "Open Loops";
    case "preference":
      return "Preferences";
    case "error":
      return "Errors";
    case "note":
      return "Notes";
  }
}
