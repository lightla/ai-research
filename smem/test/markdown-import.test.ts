import { expect, test } from "vitest";
import { parseMarkdownImport } from "../src/render/markdown-import";

test("parses type/title from the heading and content from the body", () => {
  const md = `
## decision: Storage engine
tags: storage, database

Chose PostgreSQL over MongoDB because we need ACID transactions.
`;
  const { records, skippedEmpty } = parseMarkdownImport(md);
  expect(skippedEmpty).toBe(0);
  expect(records).toHaveLength(1);
  expect(records[0]?.input.type).toBe("decision");
  expect(records[0]?.input.title).toBe("Storage engine");
  expect(records[0]?.input.tags).toEqual(["storage", "database"]);
  expect(records[0]?.input.content).toBe("Chose PostgreSQL over MongoDB because we need ACID transactions.");
});

test("parses multiple records separated by level-2 headings", () => {
  const md = `
# My Notes

## decision: A
Content A.

## todo: B
tags: x
Content B.

## error: C

Content C.
`;
  const { records } = parseMarkdownImport(md);
  expect(records.map((r) => r.input.type)).toEqual(["decision", "todo", "error"]);
  expect(records.map((r) => r.input.title)).toEqual(["A", "B", "C"]);
  expect(records[1]?.input.content).toBe("Content B.");
});

test("falls back to type=note with the full heading as title when there's no recognized type prefix", () => {
  const md = `
## Just a plain heading
Some content here.
`;
  const { records } = parseMarkdownImport(md);
  expect(records).toHaveLength(1);
  expect(records[0]?.input.type).toBe("note");
  expect(records[0]?.input.title).toBe("Just a plain heading");
});

test("falls back to note when the heading prefix isn't a recognized memory type", () => {
  const md = `
## random: Not a real type
Content.
`;
  const { records } = parseMarkdownImport(md);
  expect(records[0]?.input.type).toBe("note");
  expect(records[0]?.input.title).toBe("random: Not a real type");
});

test("skips headings with no content instead of erroring", () => {
  const md = `
## todo: Empty one
tags: a, b

## decision: Real one
Has content.
`;
  const { records, skippedEmpty } = parseMarkdownImport(md);
  expect(skippedEmpty).toBe(1);
  expect(records).toHaveLength(1);
  expect(records[0]?.input.title).toBe("Real one");
});

test("parses decision metadata (chosen/rejected/reason) into structured fields", () => {
  const md = `
## decision: Storage engine
chosen: PostgreSQL
rejected: MongoDB, MySQL
reason: need ACID transactions

Free-text elaboration.
`;
  const { records } = parseMarkdownImport(md);
  expect(records[0]?.input.decision).toEqual({
    chosen: "PostgreSQL",
    rejectedAlternatives: ["MongoDB", "MySQL"],
    reasoning: "need ACID transactions"
  });
});

test("per-record scope metadata overrides the caller's default scope", () => {
  const md = `
## preference: Team-wide convention
scope: global

Use conventional commits.
`;
  const { records } = parseMarkdownImport(md);
  expect(records[0]?.scope).toBe("global");
});

test("stops metadata parsing at the first non key:value line and treats it as content", () => {
  const md = `
## context: Architecture
tags: storage
This line has no colon and starts the content immediately.
More content.
`;
  const { records } = parseMarkdownImport(md);
  expect(records[0]?.input.tags).toEqual(["storage"]);
  expect(records[0]?.input.content).toBe("This line has no colon and starts the content immediately.\nMore content.");
});

test("returns no records for markdown with no headings at all", () => {
  const { records, skippedEmpty } = parseMarkdownImport("Just some prose, no headings.");
  expect(records).toHaveLength(0);
  expect(skippedEmpty).toBe(0);
});
