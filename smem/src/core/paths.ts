import { homedir } from "node:os";
import { basename, resolve } from "node:path";

export function expandHome(input: string): string {
  if (input === "~") {
    return homedir();
  }

  if (input.startsWith("~/")) {
    return resolve(homedir(), input.slice(2));
  }

  return resolve(input);
}

export function defaultSmartMemoryHome(): string {
  return process.env.SMEM_HOME ? expandHome(process.env.SMEM_HOME) : resolve(homedir(), ".smart-memory");
}

export function defaultProjectName(cwd: string): string {
  return basename(resolve(cwd)) || "project";
}

export function normalizePath(input: string): string {
  return resolve(input);
}
