# Zep

## Nó là gì
Zep là một **End-to-End Context Engineering Platform** — hosted cloud service (không self-hosted) cho AI agents. Core innovation: **Temporal Knowledge Graph** (powered bởi Graphiti framework) tự động extract entities và relationships từ conversations, gắn timestamp `valid_at` / `invalid_at` để track fact evolution theo thời gian. Design goal: sub-200ms retrieval latency.

## Stack kỹ thuật
- **Hosted SaaS** — không có self-hosted option (Community Edition deprecated)
- **Graphiti**: open-source temporal knowledge graph framework (getzep/graphiti)
- **Hybrid retrieval**: vector similarity + graph traversal + temporal filter
- **Rerankers**: cross_encoder / RRF / MMR (pluggable)
- **SDK**: Python + Go (API parity)

## Core Data Model

### Temporal Edge — điểm đặc biệt nhất của Zep
```python
EntityEdge(
    source: EntityNode,
    target: EntityNode,
    relationship_type: str,    # PREFERS, VISITED, KNOWS, WORKS_AT, ...
    fact: str,                 # "User prefers Adidas shoes"
    valid_at: datetime,        # khi fact bắt đầu đúng
    invalid_at: datetime|None, # khi fact hết hiệu lực (None = vẫn đúng)
    attributes: dict           # custom metadata
)
```

**Temporal reasoning thực tế:**
```
Message: "I prefer Adidas"  → Edge(User→Adidas, PREFERS, valid_at=T1, invalid_at=None)
Message: "I now prefer Puma" → Edge(User→Adidas, PREFERS, valid_at=T1, invalid_at=T2)
                               Edge(User→Puma, PREFERS, valid_at=T2, invalid_at=None)

Query tại T1.5 → "User prefers Adidas"
Query tại T3   → "User prefers Puma"
```

### Entity Types (auto-extracted)
```
User, Assistant (singletons)
Person, Location, Event, Preference, Object, Topic, Organization, Document
```
Custom ontology: định nghĩa thêm types qua Pydantic models (ví dụ: `Destination`, `Accommodation`, `Experience` cho travel agent).

### Hierarchy
```
User → Thread (conversation) → Messages
     → Graph (entities + edges extracted từ messages)
     → Episodes (raw data points ingested)
```

## Kỹ thuật từ source code

### Ingestion Pipeline
```python
# 1. Add messages → Zep auto-extract entities + relationships
client.thread.add_messages(thread_id, messages)

# 2. Add arbitrary data → Zep extract entities từ text/json
client.graph.add(user_id, type="text|json|message", data=content)

# 3. Document chunking pattern (chunk_and_ingest.py):
chunks = split_document(doc, size=500, overlap=50)
for chunk in chunks:
    # contextualize: "Situate chunk within full document"
    context = llm.contextualize(chunk, full_doc)
    client.graph.add(user_id, type="text", data=f"{context}\n\n{chunk}")
```

**Contextualized chunking** (Anthropic technique): mỗi chunk được inject document-level context trước khi ingest → retrieval accuracy cao hơn.

### Search & Retrieval
```python
# Hybrid: vector + graph + temporal
results = client.graph.search(
    user_id=user_id,
    query="What are the user's travel preferences?",
    scope="edges|nodes|all",
    limit=4,
    reranker="cross_encoder|rrf|mmr"
)
# Returns: EntityEdge[], EntityNode[], Episodes[]

# Thread context (pre-formatted)
context = client.thread.get_user_context(
    thread_id=thread_id,
    mode="basic|summary|contextual"
)
```

### Context Templates — Dynamic Assembly
```python
# Define template once
template = """
# USER SUMMARY
%{user_summary}

# PREFERENCES
%{edges limit=4 types=[PREFERS,HAS_REQUIREMENT]}

# KEY ENTITIES
%{entities limit=3}
"""
client.context.create_context_template(template_id="pref-v1", template=template)

# Retrieve: Zep fills template variables automatically
context = client.thread.get_user_context(thread_id, mode="basic")
```

Variables: `%{user_summary}`, `%{edges limit=N types=[...]}`, `%{entities limit=N}`, `%{episodes limit=N}`.

**Ý tưởng hay**: tách "format context" ra khỏi application code. Template là declarative spec, retrieval là execution.

### Graph Operations
```python
# Custom ontology
client.graph.set_ontology(
    user_ids=["..."],
    entities={"Person": PersonModel, "Location": LocationModel},
    edges={"TRAVELS_TO": (TravelsToModel, [source_target_spec])}
)

# Direct edge manipulation
client.graph.add_entity_edge(
    user_id=user_id,
    target=EntityEdgeSourceTarget(source="User", target="Adidas"),
    relationship_type="PREFERS",
    fact="User prefers Adidas",
    valid_at=datetime.now()
)
```

## Benchmark — LOCOMO
- **10 synthetic users, ~35 conversation sessions/user**
- Metrics: accuracy, retrieval latency (~200-800ms), response latency (~500-2000ms)
- Categories: Navigation, Media Playback, Communication
- Temporal reasoning test: query fact tại specific point in time

## Điểm mạnh
- **Temporal Knowledge Graph** là unique và thực sự có giá trị — fact validity tracking thực sự, không phải chỉ timestamp. Cho phép "what did user prefer in January?" query
- **Sub-200ms retrieval**: designed cho real-time agent interactions, không phải batch
- **Auto entity extraction**: không cần define schema upfront, Zep extract từ raw conversations
- **Context Templates**: declarative context assembly, tách format khỏi retrieval logic
- **Contextualized document chunking**: inject document context vào mỗi chunk trước khi ingest
- **Pluggable reranking**: cross_encoder / RRF / MMR
- **Multi-source**: combine chat history + structured data + documents trong một graph

## Điểm yếu
- **Hosted-only**: không self-host, phụ thuộc Zep Cloud. Offline không được
- **LLM-dependent extraction**: non-deterministic — cùng text có thể extract entities khác nhau mỗi lần
- **Giới hạn aggregation**: chủ yếu trả raw facts/entities, ít pre-computed aggregations
- **Custom ontology verbose**: phải define Pydantic models — không flexible như JSON schema
- **Không có global/local boundary**: user-scoped nhưng không có project-level isolation
- **No lifecycle hooks tự động**: agent phải chủ động gọi search/add

## Pattern có thể học cho Smart Memory

### Pattern 1: Temporal Fact Model (★★★★★)
```python
# Mỗi memory/fact có validity period, không phải chỉ timestamp
Memory {
    fact: str
    valid_at: datetime
    invalid_at: datetime | None   # None = vẫn còn đúng
}
# Khi fact thay đổi: đóng old record (set invalid_at), tạo new record
# Cho phép query: "decisions made in January 2025"
```

**Đây là pattern bị thiếu ở hầu hết refs khác.** agentmemory có `supersedes[]` nhưng không có temporal validity query. ICM có decay nhưng không track khi nào fact cụ thể hết hiệu lực.

### Pattern 2: Context Templates (★★★★)
```python
# Declarative format, không hardcode trong application:
template = """
%{critical_decisions limit=3}
%{recent_preferences limit=5}
%{open_tasks limit=2}
"""
# Agent chỉ gọi get_context(project_id, template_id)
# Không cần biết internals của retrieval
```

Smart Memory nên có template system: user định nghĩa "context format" cho project, agent nhận pre-formatted context mà không cần biết internals.

### Pattern 3: Contextualized Chunking (★★★)
Khi ingest document/spec vào memory, không chunk raw mà inject document-level context vào mỗi chunk trước:
```
"[Context: This is section 3 of the architecture spec about storage layer]
The system uses SQLite for local storage because..."
```
Cải thiện retrieval accuracy đáng kể.

### Pattern 4: Scope-Aware Search (★★★)
`search(scope="edges|nodes|episodes")` — caller chọn loại knowledge cần. Không dump tất cả. Smart Memory nên có: `recall(type="decisions|preferences|facts|all")`.

## Mức độ phù hợp với Smart Memory
- **Kế thừa**: temporal fact model (valid_at/invalid_at), context templates, contextualized chunking, scope-aware search
- **Không kế thừa**: hosted-only dependency, auto entity extraction (quá non-deterministic cho structured memory)
- **Gap Zep tạo ra**: không có global/local project boundary, không có lifecycle hooks tự động
