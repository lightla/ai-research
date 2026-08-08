import type { MemoryInput } from "../core/schema";
import { MemoryTypeSchema } from "../core/schema";

// Markdown -> memory records, for `smem feed <file>`. This is the write direction; markdown.ts
// is the read-only render direction (smem -> markdown, never re-imported — see PURPOSE.md's
// "web/markdown is a view, not a source of truth"). This is a separate, purpose-built grammar
// for agent-authored bulk input, not meant to round-trip render output.
//
// Grammar (see default-guide.md's "Markdown Import" section for the agent-facing version):
//
//   ## <type>: <title>
//   key: value
//   key: value
//
//   content, one or more paragraphs, until the next "## " heading or end of file.
//
// - Anything before the first "## " heading (e.g. a top-level "# My Notes" title) is ignored.
// - "<type>" must be one of decision/context/todo/preference/error/note (case-insensitive). If
//   the heading has no ": " or the prefix isn't a recognized type, the whole heading text becomes
//   the title and type defaults to "note" — a forgiving fallback, not a parse error.
// - Metadata lines are optional, must immediately follow the heading (no blank line required
//   between heading and metadata), and stop at the first blank line or first non-"key: value"
//   line. Recognized keys: tags, namespace, scope, chosen, rejected, reason (case-insensitive).
//   tags/rejected are comma-separated.
// - A record whose content is empty after trimming is skipped, not an error — most likely a
//   heading with only metadata and nothing else, or a stray heading.

const RECOGNIZED_TYPES = new Set(MemoryTypeSchema.options);
const METADATA_LINE = /^([A-Za-z][A-Za-z_-]*)\s*:\s*(.*)$/;

export type ParsedMarkdownRecord = {
  input: MemoryInput;
  scope?: "local" | "global";
};

export type MarkdownImportResult = {
  records: ParsedMarkdownRecord[];
  skippedEmpty: number;
};

export function parseMarkdownImport(markdown: string): MarkdownImportResult {
  const lines = markdown.split(/\r?\n/);
  const headingStarts: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^##\s+\S/.test(lines[i]!)) {
      headingStarts.push(i);
    }
  }

  const records: ParsedMarkdownRecord[] = [];
  let skippedEmpty = 0;

  for (let h = 0; h < headingStarts.length; h += 1) {
    const start = headingStarts[h]!;
    const end = headingStarts[h + 1] ?? lines.length;
    const headingText = lines[start]!.replace(/^##\s+/, "").trim();
    const { type, title } = parseHeading(headingText);

    let cursor = start + 1;
    const metadata: Record<string, string> = {};
    while (cursor < end) {
      const line = lines[cursor]!;
      if (line.trim() === "") {
        cursor += 1;
        break;
      }
      const match = METADATA_LINE.exec(line);
      if (!match) {
        break;
      }
      metadata[match[1]!.toLowerCase()] = match[2]!.trim();
      cursor += 1;
    }

    const content = lines
      .slice(cursor, end)
      .join("\n")
      .trim();

    if (!content) {
      skippedEmpty += 1;
      continue;
    }

    const tags = splitList(metadata["tags"]);
    const rejectedAlternatives = splitList(metadata["rejected"]);
    const hasDecisionFields = Boolean(metadata["chosen"] || rejectedAlternatives.length > 0 || metadata["reason"]);

    records.push({
      input: {
        type,
        content,
        tags,
        status: "active",
        ...(title ? { title } : {}),
        ...(metadata["namespace"] ? { namespace: metadata["namespace"] } : {}),
        ...(hasDecisionFields
          ? {
              decision: {
                ...(metadata["chosen"] ? { chosen: metadata["chosen"] } : {}),
                rejectedAlternatives,
                ...(metadata["reason"] ? { reasoning: metadata["reason"] } : {})
              }
            }
          : {})
      },
      ...(metadata["scope"] === "local" || metadata["scope"] === "global" ? { scope: metadata["scope"] } : {})
    });
  }

  return { records, skippedEmpty };
}

function parseHeading(headingText: string): { type: MemoryInput["type"]; title?: string } {
  const separatorIndex = headingText.indexOf(":");
  if (separatorIndex === -1) {
    return { type: "note", title: headingText };
  }

  const prefix = headingText.slice(0, separatorIndex).trim().toLowerCase();
  const rest = headingText.slice(separatorIndex + 1).trim();
  if (RECOGNIZED_TYPES.has(prefix as MemoryInput["type"])) {
    return { type: prefix as MemoryInput["type"], ...(rest ? { title: rest } : {}) };
  }

  return { type: "note", title: headingText };
}

function splitList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
