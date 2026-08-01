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
  const typesDir = join(renderedDir, "types");
  const tagsDir = join(renderedDir, "tags");
  mkdirSync(typesDir, { recursive: true });
  mkdirSync(tagsDir, { recursive: true });

  const typeGroups = groupByType(memories);
  const indexLines = [
    `# ${project.projectName}`,
    "",
    `Project ID: \`${project.projectId}\``,
    "",
    "## Views",
    "",
    ...["decision", "context", "todo", "preference", "error", "note"].flatMap((type) =>
      typeGroups.has(type as MemoryRecord["type"]) ? [`- [${titleForType(type as MemoryRecord["type"])}](types/${type}.md)`] : []
    ),
    "",
    "- [All tags](tags/index.md)",
    "",
    "## Memories",
    "",
    renderMarkdown(project, memories).split("\n").slice(4).join("\n")
  ];
  writeFileSync(indexPath, indexLines.join("\n").trimEnd() + "\n", "utf8");

  for (const type of ["decision", "context", "todo", "preference", "error", "note"] as const) {
    const group = typeGroups.get(type) ?? [];
    if (group.length > 0) {
      writeFileSync(join(typesDir, `${type}.md`), renderGroup(titleForType(type), group), "utf8");
    }
  }

  const tags = new Map<string, MemoryRecord[]>();
  for (const memory of memories) {
    for (const tag of memory.tags) {
      tags.set(tag, [...(tags.get(tag) ?? []), memory]);
    }
  }
  const tagIndex = ["# Tags", "", ...[...tags.keys()].sort().map((tag) => `- [${tag}](./${tagSlug(tag)}.md)`), ""];
  writeFileSync(join(tagsDir, "index.md"), tagIndex.join("\n"), "utf8");
  for (const [tag, group] of tags) {
    writeFileSync(join(tagsDir, `${tagSlug(tag)}.md`), renderGroup(`Tag: ${tag}`, group), "utf8");
  }

  return indexPath;
}

function renderGroup(title: string, memories: MemoryRecord[]): string {
  const lines = [`# ${title}`, ""];
  for (const memory of memories) {
    lines.push(`## ${memory.title ?? memory.id}`, "", memory.content, "", `ID: \`${memory.id}\``, `Updated: ${memory.updatedAt}`, "");
  }
  return lines.join("\n");
}

function tagSlug(tag: string): string {
  return tag.trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "untagged";
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
