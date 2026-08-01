import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultSmartMemoryHome } from "../core/paths";

export function readGuide(): string {
  const userGuide = join(defaultSmartMemoryHome(), "agent-guide.md");
  if (existsSync(userGuide)) {
    return readFileSync(userGuide, "utf8");
  }

  return readFileSync(defaultGuidePath(), "utf8");
}

function defaultGuidePath(): string {
  const sourcePath = join(__dirname, "default-guide.md");
  if (existsSync(sourcePath)) {
    return sourcePath;
  }

  return join(__dirname, "..", "guide", "default-guide.md");
}
