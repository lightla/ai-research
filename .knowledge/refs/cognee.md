# Cognee

## Nó là gì
Cognee là một **memory control plane** cho AI agents, áp dụng pipeline **ECL (Extract, Cognify, Load)** thay vì RAG thông thường. "Deterministic" memory nghĩa là: entity IDs dựa trên identity fields → deterministic UUID5 (không random UUID4), có ontology grounding (OWL), và versioning + provenance tracking. Nhắm đến reproducibility và debuggability.

## Stack kỹ thuật
- **Graph DB**: Ladybug (default), Neo4j, Neptune, Postgres adapters
- **Vector DB**: LanceDB (default), ChromaDB, PGVector
- **Relational**: SQLite (default), Postgres
- **Cache**: Redis hoặc Filesystem
- **Entity extraction**: Instructor library (structured LLM output)
- **Ontology**: rdflib (OWL), fuzzy matching 80% threshold
- **MCP**: Native MCP server (stdio/SSE/HTTP)

## Core Pipeline: ECL

```
Input (file/URL/text/DB)
    ↓ E: Extract
ingest_data → store in relational DB (Dataset + Data records)
    ↓ C: Cognify
1. classify_documents      → identify doc types/structure
2. extract_chunks          → semantic text segmentation
3. extract_graph_from_data → LLM (Instructor) → KnowledgeGraph
4. summarize_text          → pre-computed chunk summaries
5. add_data_points         → nodes/edges → graph DB + vector DB
6. index_graph_edges       → searchable indices
7. extract_dlt_fk_edges    → deterministic edges từ schema metadata
    ↓ L: Load
Graph stored, queryable via 15+ search strategies
```

## DataPoint — Base Class với Deterministic IDs

```python
class DataPoint:
    id: UUID  # UUID5 từ identity fields — DETERMINISTIC
    version: int
    ontology_valid: bool
    belongs_to_set: list[DataPoint|str]

    # Provenance
    source_pipeline: str    # e.g., "cognify_pipeline"
    source_task: str        # e.g., "extract_graph_from_data"
    source_user: str
    source_content_hash: str

    # Weighting
    feedback_weight: float = 0.5
    importance_weight: float = 0.5

    # Annotations
    @Embeddable()   # → generate vector embeddings
    @Dedup()        # → dedup during graph expansion
```

**Identity-based dedup**: Cùng entity (same identity fields) → same UUID5 → tự động deduplicate.

## Graph Data Model

### Knowledge Graph (LLM-extracted)
```python
class Node:
    id, name, type, description

class Edge:
    source_node_id, target_node_id
    relationship_name: str
    description: str  # "concrete one-sentence fact" — không chỉ pointer

class KnowledgeGraph:
    nodes: list[Node]
    edges: list[Edge]
```

Edge types: extracted từ LLM, FK edges từ schema, temporal edges, skill execution edges.

## 15+ Search Strategies

```python
SearchType:
  CHUNKS                         # pure vector similarity
  CHUNKS_LEXICAL                 # keyword FTS
  RAG_COMPLETION                 # legacy RAG → LLM
  TRIPLET_COMPLETION            # Subject-Predicate-Object decomposition
  GRAPH_COMPLETION              # DEFAULT: graph traversal + LLM
  GRAPH_COMPLETION_COT          # chain-of-thought
  GRAPH_COMPLETION_CONTEXT_EXTENSION   # expand neighborhood
  GRAPH_COMPLETION_DECOMPOSITION       # query decomposition
  TEMPORAL                      # time-aware graph search
  NATURAL_LANGUAGE              # convert to structured query
  AGENTIC_COMPLETION            # multi-step agent reasoning
  FEELING_LUCKY                 # auto-route best strategy
  CODING_RULES                  # code-specific
```

**Auto-routing**: `query_router.py` — rule-based classifier, logs auto-route vs manual override.

**Triplet Search Context Provider** (core strategy):
```
Query → extract noun phrases (entities)
      → vector search (triplet embeddings)
      → graph traversal (k-hop neighborhood)
      → LLM completion (synthesize context)
```

## 3-Tier Memory Architecture

### Tier 1: Session Cache (Fast, Ephemeral)
```python
SessionQAEntry { question, context, answer, feedback_score, used_graph_element_ids }
SessionAgentTraceEntry { origin_function, status, method_params, memory_query, memory_context }
```
- Keyword-based search (tokenized overlap)
- Cross-user visibility via permissions

### Tier 2: Permanent Graph (Structured, Queryable)
- Vector DB + Graph DB + Relational DB — 3 stores synchronized

### Tier 3: Typed Memory Entries
```python
QAEntry         # Q&A turn
TraceEntry      # Tool call step với params + return value
FeedbackEntry   # Score + text feedback
SkillRunEntry   # Skill execution với success_score
```

**Sync**: `improve()` bridges Tier 1 → Tier 2 (session cache → permanent graph).

## Ontology System

```python
# OWL-grounded entity validation
ONTOLOGY_RESOLVER=rdflib
MATCHING_STRATEGY=fuzzy  # 80% similarity threshold

# extract_graph_from_data():
ontology_resolver = get_default_ontology_resolver()
# LLM extracts generic KnowledgeGraph
# Validate nodes/edges against OWL schema
# Fuzzy match to standard vocabulary
# Stamp ontology_valid=True on validated nodes
```

Ontology grounding → consistency across sessions và users.

## Skill Improvement Loop

```python
# Log execution
await remember(SkillRunEntry(
    selected_skill_id="skill_123",
    success_score=0.92,
    result_summary="..."
))

# improve() với skill_improvement
await improve(dataset="main", skill_improvement={
    "skill_name": "entity_extraction",
    "apply": True,
    "proposal_id": "prop_456"
})
```

## Điểm mạnh
- **Deterministic UUID5**: Same entity = same ID. Reproducible, debuggable, deduplication tự động
- **Ontology grounding**: Domain-specific semantics, không phải free-form
- **15+ search strategies với auto-routing**: Không phải một-size-fits-all
- **3-tier session + graph + typed**: Rõ ràng lifecycle từng tier
- **Typed memory entries**: `TraceEntry`, `SkillRunEntry` — rich semantics cho agent interactions
- **MCP native**: Direct Claude integration out-of-the-box
- **Multi-tenant**: Per-(user,dataset) database isolation khi `ENABLE_BACKEND_ACCESS_CONTROL=True`
- **Provenance bắt buộc**: source_pipeline, source_task, source_content_hash trên mọi DataPoint

## Điểm yếu
- **LLM extraction non-deterministic về content**: UUID5 deterministic nhưng entity content vẫn có thể vary
- **Ontology setup phức tạp**: OWL files, rdflib — learning curve cao
- **3 databases để maintain**: Graph + Vector + Relational — operational overhead
- **Session → Graph sync thủ công**: Phải gọi `improve()` explicit, không tự động
- **Không có lifecycle hooks tự động**: Không hook vào agent session

## Pattern học cho Smart Memory

### Pattern 1: UUID5 Identity-Based Deduplication (★★★★★)
```python
# Identity fields → deterministic UUID5
class Memory(DataPoint):
    metadata = {"identity_fields": ["topic", "source_session"]}
# Same topic + same session → same ID → auto-dedup, không cần similarity check riêng
```
Thay vì similarity threshold (0.85), dùng UUID5 cho deterministic dedup khi identity rõ.

### Pattern 2: Typed Entries với Rich Agent Semantics (★★★★)
Không chỉ store "memory string". Store typed entries: `TraceEntry` cho tool calls, `SkillRunEntry` cho skill execution. Cho phép query: "tất cả tool calls fail trong session này?"

### Pattern 3: Provenance bắt buộc trong Schema (★★★★)
Mọi record phải có: `source_pipeline`, `source_task`, `source_content_hash`. Không optional. Cho phép audit "memory này đến từ đâu, được tạo bởi task nào?"

### Pattern 4: Auto-Routing Search Strategy (★★★)
Thay vì expose một search API, có query_router phân loại query type và route về strategy phù hợp. User/agent không cần biết TRIPLET vs GRAPH_COMPLETION vs CHUNKS.
