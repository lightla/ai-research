import type { MemoryRecord, ProjectRecord } from "../core/schema";

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
  const title = memory.title ? ` ${memory.title}` : "";
  const tags = memory.tags.length > 0 ? ` [${memory.tags.join(", ")}]` : "";
  const status = memory.status !== "active" ? ` (${memory.status})` : "";
  return `${memory.id} ${memory.type}${status}${title}${tags}\n${memory.content}`;
}
