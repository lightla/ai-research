import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { MemoryRecordSchema, ProjectRecordSchema, type MemoryRecord, type ProjectRecord } from "../core/schema";

const ExportSchema = z.object({
  format: z.literal("smem-memory-export"),
  version: z.literal(1),
  exportedAt: z.string().min(1),
  project: ProjectRecordSchema,
  scope: z.enum(["local", "global"]),
  memories: z.array(MemoryRecordSchema)
});

export type MemoryExport = z.infer<typeof ExportSchema>;

export function writeMemoryExport(path: string, project: ProjectRecord, scope: "local" | "global", memories: MemoryRecord[]): string {
  const outputPath = resolve(path);
  const payload: MemoryExport = {
    format: "smem-memory-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
    scope,
    memories
  };
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return outputPath;
}

export function readMemoryExport(path: string): MemoryExport {
  const inputPath = resolve(path);
  if (!existsSync(inputPath)) {
    throw new Error(`Export file not found: ${inputPath}`);
  }
  try {
    return ExportSchema.parse(JSON.parse(readFileSync(inputPath, "utf8")));
  } catch (error) {
    throw new Error(`Invalid smem export: ${error instanceof Error ? error.message : String(error)}`);
  }
}
