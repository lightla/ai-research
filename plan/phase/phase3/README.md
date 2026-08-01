# Phase 3: Retrieval Quality

Phase 3 starts after the local memory lifecycle is usable. Its purpose is to improve which memories an agent receives, how much context it receives, and why a result was selected.

Current status: core Phase 3 retrieval work is implemented and verified. The retrieval contract, filters, deterministic ranking, bounded context, explain output, and benchmark fixtures are in place.

This phase stays local-first and CLI-first. It does not add a web app, cloud sync, team sharing, or automatic official-memory promotion.

## Goal

Given a query such as "how should this project store data?", smem should return a small, relevant, explainable set of official memories instead of a large lexical dump.

## Retrieval Pipeline

```text
query
  -> normalize query and filters
  -> lexical candidate set (contains/FTS)
  -> optional semantic candidate set
  -> rank by relevance + type + trust + recency
  -> apply scope/topic/tag filters
  -> compact context budget
  -> explain result ids and retrieval mode
```

## Planned Features

1. Topic and tag focus

Add `--topic`, `--tag`, `--type`, and `--status` filters. Topics come from offline classification and tags remain user-editable source metadata.

2. Better ranking

Combine lexical score, semantic score when available, memory type priority, recency decay, source kind, and promotion status. Ranking must be deterministic for the same data and query.

3. Context budget

Add a token-independent character/word budget for `context` and recall output. Return the highest-value records first and report when records were omitted.

4. Semantic fallback

Keep `contains` and `fts` fully offline. Use semantic or hybrid retrieval only when an embedding provider is explicitly configured. Do not silently call a remote provider.

5. Explainable retrieval

Add a verbose result mode showing why a record matched: lexical term, tag/topic, semantic score, type priority, or recency adjustment.

6. Retrieval evaluation fixtures

Create a small local benchmark containing representative project decisions, todos, errors, and irrelevant records. Measure top-k relevance and noise before changing ranking weights.

## Non-goals

- No web UI.
- No LLM-based reranking in the default path.
- No automatic promotion from candidate to official memory.
- No graph database or cross-project merge system.
- No persistent daemon.

## Exit Criteria

Phase 3 is complete when retrieval supports explicit filters and a bounded context, ranking is deterministic and explainable, offline modes remain zero-token, semantic mode is opt-in, and fixture evaluation shows less noise than the Phase 2 baseline.
