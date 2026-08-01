# Decision: Add Explicit Recall Modes And Vector Search

## Status

Approved and implemented for Phase 1.5.

## Context

Agents need to choose whether they want exact lexical lookup or smart semantic lookup. FTS is not enough for questions that use different words than the stored memory.

## Decision

Add explicit recall modes:

```bash
smem recall --mode contains "exact phrase"
smem recall --mode fts "outsider store"
smem recall --mode semantic "why not write files into company repos?"
smem recall --mode hybrid "why not write files into company repos?"
```

Add vector indexing:

```bash
smem index --provider openai
```

Default recall mode remains `fts` so `smem recall` does not unexpectedly call an embedding API.

## Storage

Embeddings are stored as a derived index in the same SQLite DB:

```text
memory_embeddings(memory_id, project_id, scope, provider, model, dimensions, vector_json, content_hash, updated_at)
```

Memory records remain the source of truth. Embeddings can be rebuilt.

## Provider

The first provider is OpenAI-compatible embeddings via:

```text
OPENAI_API_KEY
OPENAI_BASE_URL optional
SMEM_EMBEDDING_MODEL optional, default text-embedding-3-small
```

OpenAI docs describe embeddings as vector representations for search, clustering, recommendations, and related tasks. The Create embeddings API returns embedding vectors for input strings using models such as `text-embedding-3-small` and `text-embedding-3-large`.

## Boundary

`contains` and `fts` are zero-cost local search.

`semantic` and `hybrid` call the embedding provider for query embedding and require a prebuilt vector index. This is not chat LLM reasoning, but it is still an API call/cost when using a remote embedding provider.
