import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultSmartMemoryHome } from "../core/paths";
import { processCandidates, type ProcessResult } from "../process/candidate-processor";
import { RegistryRepository } from "../storage/registry-repository";

export type DaemonOptions = {
  cwd: string;
  scope: "local" | "global";
  intervalMs: number;
  home?: string;
  onCycle?: (result: ProcessResult) => void;
};

export type DaemonMetadata = {
  pid: number;
  cwd: string;
  scope: "local" | "global";
  startedAt: string;
  intervalMs: number;
  lastCycleAt?: string;
  lastResult?: ProcessResult;
};

export function processOnce(options: { cwd: string; scope: "local" | "global"; home?: string }): ProcessResult {
  const home = options.home ?? defaultSmartMemoryHome();
  const registry = new RegistryRepository(home);
  try {
    const project = registry.requireCurrentProject(options.cwd);
    return processCandidates({ project, scope: options.scope, home });
  } finally {
    registry.close();
  }
}

export async function runDaemon(options: DaemonOptions): Promise<void> {
  const home = options.home ?? defaultSmartMemoryHome();
  const release = acquireDaemonLock(home);
  if (!release) {
    throw new Error(`smem daemon is already running for ${home}`);
  }

  const metadata: DaemonMetadata = {
    pid: process.pid,
    cwd: options.cwd,
    scope: options.scope,
    startedAt: new Date().toISOString(),
    intervalMs: options.intervalMs
  };
  const metadataPath = daemonMetadataPath(home);
  mkdirSync(join(home, "events"), { recursive: true });
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    while (!stopping) {
      const result = processOnce({ cwd: options.cwd, scope: options.scope, home });
      metadata.lastCycleAt = new Date().toISOString();
      metadata.lastResult = result;
      writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
      options.onCycle?.(result);
      await delay(options.intervalMs);
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    try {
      unlinkSync(metadataPath);
    } catch {
      // The status file may already have been cleaned by recovery logic.
    }
    release();
  }
}

export function daemonStatus(home = defaultSmartMemoryHome()): DaemonMetadata | null {
  const path = daemonMetadataPath(home);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const metadata = JSON.parse(readFileSync(path, "utf8")) as DaemonMetadata;
    if (!isProcessAlive(metadata.pid)) {
      cleanupDaemonFiles(home);
      return null;
    }
    return metadata;
  } catch {
    cleanupDaemonFiles(home);
    return null;
  }
}

export function stopDaemon(home = defaultSmartMemoryHome()): boolean {
  const metadata = daemonStatus(home);
  if (!metadata) {
    return false;
  }
  process.kill(metadata.pid, "SIGTERM");
  return true;
}

function acquireDaemonLock(home: string): (() => void) | null {
  const eventsDir = join(home, "events");
  const lockPath = join(eventsDir, "daemon.lock");
  mkdirSync(eventsDir, { recursive: true });
  try {
    const descriptor = openSync(lockPath, "wx");
    return () => {
      closeSync(descriptor);
      try {
        unlinkSync(lockPath);
      } catch {
        // Already removed by stale-lock recovery.
      }
    };
  } catch {
    try {
      if (Date.now() - statSync(lockPath).mtimeMs > 5 * 60 * 1000) {
        unlinkSync(lockPath);
        return acquireDaemonLock(home);
      }
    } catch {
      // A concurrent process may be creating or removing the lock.
    }
    return null;
  }
}

function daemonMetadataPath(home: string): string {
  return join(home, "events", "daemon.json");
}

function cleanupDaemonFiles(home: string): void {
  for (const path of [daemonMetadataPath(home), join(home, "events", "daemon.lock")]) {
    try {
      unlinkSync(path);
    } catch {
      // File is already absent.
    }
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
