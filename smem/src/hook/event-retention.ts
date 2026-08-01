import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultSmartMemoryHome } from "../core/paths";

export type ArchiveResult = {
  scanned: number;
  archived: number;
  kept: number;
  invalid: number;
  archivePath?: string;
};

export function archiveRawEvents(options: { olderThanDays: number; home?: string; now?: number }): ArchiveResult {
  if (!Number.isFinite(options.olderThanDays) || options.olderThanDays <= 0) {
    throw new Error("olderThanDays must be a positive number.");
  }
  const home = options.home ?? defaultSmartMemoryHome();
  const queuePath = join(home, "events", "pending.jsonl");
  if (!existsSync(queuePath)) {
    return { scanned: 0, archived: 0, kept: 0, invalid: 0 };
  }

  const cutoff = (options.now ?? Date.now()) - options.olderThanDays * 86_400_000;
  const keep: string[] = [];
  const archive: string[] = [];
  let scanned = 0;
  let invalid = 0;
  for (const line of readFileSync(queuePath, "utf8").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    scanned += 1;
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      const timestamp = typeof event.timestamp === "string" ? Date.parse(event.timestamp) : Number.NaN;
      if (Number.isFinite(timestamp) && timestamp < cutoff) archive.push(trimmed);
      else keep.push(trimmed);
    } catch {
      invalid += 1;
      keep.push(trimmed);
    }
  }

  if (archive.length === 0) {
    return { scanned, archived: 0, kept: keep.length, invalid };
  }

  const archiveDir = join(home, "events", "archive");
  mkdirSync(archiveDir, { recursive: true });
  const archivePath = join(archiveDir, `${new Date(options.now ?? Date.now()).toISOString().replace(/[:.]/g, "-")}.jsonl`);
  appendFileSync(archivePath, `${archive.join("\n")}\n`, "utf8");
  const tempPath = `${queuePath}.tmp-${process.pid}`;
  writeFileSync(tempPath, keep.length > 0 ? `${keep.join("\n")}\n` : "", "utf8");
  renameSync(tempPath, queuePath);
  return { scanned, archived: archive.length, kept: keep.length, invalid, archivePath };
}
