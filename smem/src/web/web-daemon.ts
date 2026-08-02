import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type WebDaemonMetadata = {
  pid: number;
  port: number;
  startedAt: string;
};

export function webMetadataPath(home: string): string {
  return join(home, "web.json");
}

export function writeWebMetadata(home: string, metadata: WebDaemonMetadata): void {
  writeFileSync(webMetadataPath(home), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export function webStatus(home: string): WebDaemonMetadata | null {
  const path = webMetadataPath(home);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const metadata = JSON.parse(readFileSync(path, "utf8")) as WebDaemonMetadata;
    if (!isProcessAlive(metadata.pid)) {
      cleanupWebMetadata(home);
      return null;
    }
    return metadata;
  } catch {
    cleanupWebMetadata(home);
    return null;
  }
}

export function stopWeb(home: string): boolean {
  const metadata = webStatus(home);
  if (!metadata) {
    return false;
  }

  // The process is started detached, making it its own process group leader (pgid === pid).
  // Signal the whole group so any child it spawns is stopped too, not just the leader.
  try {
    process.kill(-metadata.pid, "SIGTERM");
  } catch {
    process.kill(metadata.pid, "SIGTERM");
  }
  cleanupWebMetadata(home);
  return true;
}

export function cleanupWebMetadata(home: string): void {
  try {
    unlinkSync(webMetadataPath(home));
  } catch {
    // Already removed.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
