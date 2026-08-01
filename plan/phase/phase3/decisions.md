# Phase 3 Decisions

## Local-First Default

`contains` and `fts` remain the default zero-token retrieval modes. Semantic and hybrid modes are opt-in because embeddings add model runtime, configuration, latency, or network cost.

## Official Memory Boundary

Only active official memories participate in normal retrieval. Raw events and pending candidates remain available through explicit raw/history/candidates commands, but they must not silently pollute agent context.

## Explainability Over Magical Ranking

Every ranking improvement should have a deterministic test and an inspectable reason. A lower-ranked result must be explainable by relevance, filter mismatch, recency, type, or trust metadata.

Current baseline weights are intentionally small and visible in `src/retrieval/retrieval.ts`: exact title `+6`, exact content `+5`, title term `+3`, content term `+2`, tag term `+2.5`, type priority `0.1-0.8`, trusted manual/promoted source `+0.2`, and recency up to `+0.5`. These are a starting benchmark, not hidden model output.
