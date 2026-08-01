# Phase 1 Release Check

Date: 2026-08-02

## Verdict

Phase 1 is complete for the Core MVP definition.

The verified MVP loop is:

```text
smem init
  -> external project store
  -> structured memory records
  -> list / recall / context
  -> read-only Markdown render
  -> move project root without losing memory
```

## Verified Commands

Tested with an isolated `SMEM_HOME` under `/tmp`, not the real user store.

```bash
smem init
smem store --type decision --title "Outsider store" --tag storage --tag phase1 ...
smem store --type context --tags phase1,mvp ...
smem store --type todo --tag phase2 ...
smem list --limit 5
smem recall "company repos"
smem context
smem render
smem move --project-id <project-id>
smem raw anything
smem history anything --after 3
smem process
smem candidates
```

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
npm install -g . --ignore-scripts
```

Results:

- TypeScript passed.
- Vitest passed: 5 test files, 15 tests.
- Build passed.
- Global CLI reinstall passed.
- Smoke test passed with outsider store.
- `smem move` correctly detached the old path and preserved recall from the new path.
- Empty raw/history/process/candidates commands did not crash.

## Fixes Made During Release Check

- Added `smem store --tag <tag>` as a repeatable alias next to `--tags a,b`.
- Added SQLite `busy_timeout`, WAL journal mode, and foreign keys on DB open.
- Increased Vitest timeout to 15s because integration-style SQLite/model setup can exceed the default 5s under WSL/Node 24.

## Known Non-Blocking Gaps

These are not blockers for Phase 1, but should move to Phase 2 or later:

- Phase 2 now adds direct `show` lookup for memory ids, history record ids, and raw event ids.
- Claude Code and Codex native hooks need real-world validation like Antigravity received.
- Vector search exists as command surface, but the default MVP remains lexical/offline unless an embedding provider is configured.
- Candidate extraction is conservative and review-based; it should not be treated as automatic official memory.
