# Decision: Phase 1 Search Is Lexical FTS, Not Semantic Vector Search

## Status

Approved for Phase 1.

## Context

`smem recall` needs to retrieve memory quickly and offline. Phase 1 already has SQLite FTS search. The next question is whether this counts as "smart search".

## Decision

Phase 1 uses SQLite FTS as lexical search.

FTS is not only `equals` or plain `contains`. It tokenizes text and searches indexed terms efficiently, so it is better than scanning strings manually. However, it is still lexical search: it matches words/tokens, not meaning.

Examples FTS handles well:

```text
outsider store
SQLite warning
Codex hook
commit style
PostToolUse
```

Examples FTS may miss or rank poorly:

```text
"vì sao không ghi file vào project công ty?"
"lần trước chốt hướng lưu memory ngoài repo như nào?"
"tool này giải quyết vấn đề không phải nhắc lại design ra sao?"
```

Those need semantic retrieval.

## Boundary

Current `smem recall` is:

```text
SQLite FTS + simple metadata ranking
```

It is not:

```text
embedding search
vector search
semantic reranking
LLM extraction
```

## Future Direction

Add hybrid retrieval later:

```text
smem recall <query>
  -> FTS candidates
  -> vector candidates
  -> metadata ranking
  -> merged concise result
```

FTS should remain even after vector search because it is better for exact names, commands, error codes, package names, file paths, and ids.

Potential future commands:

```bash
smem index
smem recall "query" --semantic
smem recall "query" --hybrid
```

Vector index must be derived and rebuildable. SQLite memory records remain the source of truth.
