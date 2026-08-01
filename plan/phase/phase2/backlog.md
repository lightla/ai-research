# Phase 2 Backlog

## P0

- [x] `smem show <memory-id>` for official/candidate/rejected records.
- [x] `smem history show <record-id>` to fetch one normalized transcript record.
- [x] `smem raw show <event-id>` to fetch one raw hook event.
- [x] Add tests for show-by-id behavior.

## P1

- [x] `smem edit <memory-id>` with title, type, tags, content, status-safe validation.
- [x] `smem archive <memory-id>` for non-destructive removal from active recall.
- [x] `smem export` and `smem import` JSON format.
- [x] `smem scan --store <path>` to rebuild registry from project stores.

## P2

- [x] Add Claude Code transcript fixture adapter tests.
- [x] Add Codex transcript fixture adapter tests.
- [x] Improve Markdown render with index pages by type and tag.
- [x] Add recall output mode that prints only ids/titles for cheap agent routing.

## Risks

- Raw transcript formats are agent-specific and can change.
- Direct edit commands need careful validation so official memory remains clean.
- Export/import must preserve ids and source metadata; otherwise old references become useless.
