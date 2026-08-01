# Phase 2: Usability And Retrieval Review

Phase 2 starts after the Core MVP is usable. The goal is not to add a big UI yet; the goal is to make `smem` practical for repeated daily use by users and agents. The existing web app is outside this phase.

Current status: complete. P0, P1, and P2 are implemented and verified with typecheck, tests, build, and CLI smoke tests.

## Current Starting Point

Phase 1 already shipped more than the original MVP:

- install/uninstall bootstrap for Antigravity, Claude Code, and Codex
- hook capture queue
- raw/history inspection
- candidate review layer
- global memory scope
- base58 ids
- move/delete project commands
- optional semantic/hybrid recall command surface

Because of that, Phase 2 should focus on hardening and usability instead of adding more broad features.

## Phase 2 Goal

Make stored and captured memory easy to inspect, edit, recover, and reuse without forcing the user or agent to read noisy raw logs.

Core loop:

```text
capture / store
  -> inspect by stable id
  -> edit / promote / reject
  -> retrieve with clear mode
  -> export / import / recover
```

## Priority Work

The first P0 slice is implemented: direct lookup by stable id for memories, normalized transcript records, and raw hook events. This removes the need to rescan a whole transcript after an agent has already found a useful id.

1. Record inspection by id

Add direct lookup commands:

```bash
smem show <memory-id>
smem history show <record-id>
smem raw show <event-id>
```

Reason: `history` already prints short ids. Agents need a cheap way to fetch exactly one record without re-searching a whole timeline.

2. Edit official memories

Add a safe edit flow:

```bash
smem edit <memory-id> --title "..." --type decision --tags a,b --content "..."
smem archive <memory-id>
```

Reason: Phase 1 can store and promote, but correcting bad wording currently requires new records or direct DB edits.

3. Export / import / recover

Add portable backups:

```bash
smem export --project-id <id> --out smem-export.json
smem import smem-export.json
smem scan --store ~/.smart-memory/projects
```

Reason: outsider storage avoids writing into repos, but the user still needs a clear recovery path if registry mapping is lost or machines change.

4. Raw/history adapter hardening

Keep the internal normalized shape stable:

```text
id
fromSource
agent
role
kind
timestamp
content
raw
```

Add adapter tests for Antigravity, Claude Code, and Codex sample transcripts. Default history output should stay clean; `--full` remains the escape hatch.

5. Retrieval mode clarity

Make recall modes explicit and honest:

```bash
smem recall --mode contains "exact-token"
smem recall --mode fts "keyword query"
smem recall --mode semantic "meaning query"
smem recall --mode hybrid "mixed query"
smem index --provider openai
```

Reason: FTS is not vector search. Semantic/hybrid should be opt-in and visibly require embeddings.

## Runtime Decision

Do not add a persistent process queue daemon in this phase.

`smem hook run` remains a short-lived append operation. For input/output events it may launch one detached, short-lived worker to run the existing batch processor, but the hook does not wait for it. A persistent daemon changes lifecycle, locking, crash recovery, and observability, but does not make the offline classifier more accurate. It belongs after the filtering rules, event schema, and review workflow have real usage data.

## Not In Phase 2

- Web app.
- Team/cloud sync.
- Fully automatic memory promotion.
- LLM-based cleanup of raw logs.
- Large graph or merge wizard.
- Background daemon as the default runtime.

## Completion Criteria

Phase 2 is complete when:

1. A user can fetch any printed memory/history/raw id directly.
2. A user can edit/archive official memories without touching SQLite.
3. A user can export/import a project memory store.
4. `scan` can rebuild registry entries from existing project stores.
5. Antigravity, Claude Code, and Codex transcript adapters have fixture tests.
6. `smem guide` explains when each Phase 2 command is for user use, agent use, or both.
7. Typecheck, tests, build, and smoke test pass.
