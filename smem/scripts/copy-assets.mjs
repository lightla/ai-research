import { cp, chmod, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

await cp(join(root, "src", "storage", "migrations"), join(root, "dist", "storage", "migrations"), {
  recursive: true
});

await cp(join(root, "src", "guide", "default-guide.md"), join(root, "dist", "guide", "default-guide.md"));

const entry = join(root, "dist", "cli", "index.js");
const content = await readFile(entry, "utf8");
if (!content.startsWith("#!")) {
  await writeFile(entry, `#!/usr/bin/env node\n${content}`, "utf8");
}
await chmod(entry, 0o755);
