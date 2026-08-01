# Phase 3 Backlog

## P0: Retrieval Contract

- [x] Define a `RecallOptions` and `RecallResult` internal contract.
- [x] Add `--type`, `--tag`, `--topic`, and `--status` filters.
- [x] Keep default recall restricted to active official memories.
- [x] Add deterministic ranking tests for lexical matches.

## P1: Quality And Budget

- [x] Add recency/type/source weighting with documented constants.
- [x] Add `context --limit` or equivalent bounded output.
- [x] Add `recall --compact` metadata fields for agent routing and exact follow-up lookup.
- [x] Add explainable retrieval output for debugging and evaluation.

## P2: Semantic Evaluation

- [x] Add local retrieval benchmark fixtures and top-k assertions.
- [x] Add semantic ranking coverage with a fake embedding provider.
- [x] Make missing semantic configuration fail clearly without network calls.
- [x] Document when semantic search is worth its latency/cost tradeoff.

## Risks

- Ranking weights can look intelligent while silently hiding important memories.
- Topic extraction is heuristic and must remain a filter hint, not truth.
- Context budgets can cut a critical record if ordering is wrong.
- Remote embeddings must remain explicit and never become the default path.
