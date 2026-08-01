import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { defaultSmartMemoryHome } from "../core/paths";

export type EventStats = {
  path: string;
  bytes: number;
  events: number;
  byAgent: Record<string, number>;
  byKind: Record<string, number>;
  oldest?: string;
  newest?: string;
};

export function readEventStats(home = defaultSmartMemoryHome()): EventStats {
  const path = join(home, "events", "pending.jsonl");
  if (!existsSync(path)) {
    return { path, bytes: 0, events: 0, byAgent: {}, byKind: {} };
  }

  const byAgent: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  let events = 0;
  let oldest: string | undefined;
  let newest: string | undefined;
  for (const line of readFileSync(path, "utf8").split(/\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      events += 1;
      const agent = typeof event.agent === "string" ? event.agent : "unknown";
      const kind = typeof event.captureKind === "string" ? event.captureKind : "unknown";
      byAgent[agent] = (byAgent[agent] ?? 0) + 1;
      byKind[kind] = (byKind[kind] ?? 0) + 1;
      const timestamp = typeof event.timestamp === "string" ? event.timestamp : undefined;
      if (timestamp && (!oldest || timestamp < oldest)) oldest = timestamp;
      if (timestamp && (!newest || timestamp > newest)) newest = timestamp;
    } catch {
      // Ignore a partially written or legacy-invalid line in diagnostics.
    }
  }

  return {
    path,
    bytes: statSync(path).size,
    events,
    byAgent,
    byKind,
    ...(oldest ? { oldest } : {}),
    ...(newest ? { newest } : {})
  };
}
