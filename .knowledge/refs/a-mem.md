# A-mem (Agentic Memory)

## Nó là gì
A-mem là research implementation của paper **"A-MEM: Agentic Memory for LLM Agents"** (arXiv:2502.12110, 2025). Không phải production tool. Codebase ~1,700 LOC Python với 4 module core. Đóng góp học thuật chính: **bidirectional memory evolution** — thêm memory mới không chỉ link về memories cũ mà còn có thể cập nhật ngược lại metadata của memories đã tồn tại.

## Stack kỹ thuật
- **ChromaDB** (in-memory hoặc persistent) + SentenceTransformer (all-MiniLM-L6-v2)
- **LLM backend**: OpenAI (structured output / JSON schema) hoặc Ollama (via litellm)
- **Graph**: implicit — links là list of ID strings trong MemoryNote

## Data Model

```python
MemoryNote:
  id: UUID
  content: str
  keywords: List[str]      # LLM-extracted semantic concepts
  context: str             # one-sentence domain/theme summary
  tags: List[str]          # classification labels
  links: List[str]         # IDs of related memories (edges)
  evolution_history: List  # change log
  retrieval_count: int
  timestamp, last_accessed: str (YYYYMMDDHHMM)
  category: str
```

## Kỹ thuật từ source code

### Core Algorithm: process_memory() — Bidirectional Evolution

Mỗi lần `add_note()`, A-mem gọi LLM để quyết định:

```python
process_memory(new_note):
  1. search ChromaDB → top-5 nearest neighbors
  2. format neighbors thành string cho LLM
  3. LLM call với JSON schema:
     {
       should_evolve: bool,
       actions: ["strengthen" | "update_neighbor"],
       suggested_connections: [memory_ids],   # new note links đến ai
       tags_to_update: [tags],               # new note tags mới
       new_context_neighborhood: [str×N],    # update context của neighbors
       new_tags_neighborhood: [[str]×N]      # update tags của neighbors
     }
  4. Nếu "strengthen": new_note.links += suggested_connections
  5. Nếu "update_neighbor": modify context + tags của từng neighbor trong DB
```

**Điểm độc đáo**: `update_neighbor` action — LLM có thể rewrite metadata của memories cũ dựa trên context của memory mới. Không ai khác trong nhóm làm điều này.

### Search: Vector + 1-hop link expansion

```python
search_agentic(query, k=5):
  results = chromadb.similarity_search(query, k=k)
  # mở rộng: với mỗi result, fetch linked neighbors
  # tổng không quá k results
  return results + neighbors
```

### Consolidation: Destructive rebuild

```python
consolidate_memories():
  # Trigger: mỗi evo_threshold=100 evolutions
  # Reset toàn bộ ChromaDB collection
  # Re-add ALL memories với updated metadata
  # O(n) — không incremental
```

### LLM Structured Output

JSON schema enforcement qua OpenAI structured output (`"strict": True, "additionalProperties": False`). Response guaranteed hợp lệ về structure, nhưng content vẫn có thể sai.

## Điểm mạnh
- **Bidirectional evolution**: concept độc đáo — memory mới cập nhật ngược metadata của memories cũ, không phải chỉ link một chiều
- **LLM-as-arbiter**: mọi memory operation đều có LLM decision-making thực sự
- **Clean architecture**: MemoryNote / ChromaRetriever / LLMController / AgenticMemorySystem tách bạch rõ
- **Neighbor context injection vào search**: link expansion tự nhiên tránh isolated memory problem
- **JSON schema enforcement**: structured output đảm bảo parseable response

## Điểm yếu — gaps thực tế

- **LLM call mỗi add_note**: expensive ở scale. 1,000 memories → 1,000 LLM calls. Không có batching, không async
- **Graph implicit và yếu**: links chỉ là list of ID strings. Không có bidirectional index — không biết "ai link đến memory này?". Không có graph traversal sâu hơn 1 hop
- **Index mapping bug** (lines 687-716): ChromaDB result indices được dùng như array index vào `list(self.memories.values())` — order không đảm bảo match → silent failures
- **Consolidation destructive**: rebuild toàn bộ ChromaDB, O(n), không incremental, không audit trail
- **Evolution history mờ**: chỉ là list, không có timestamps, không rollback
- **Không có lifecycle hooks**: không integrate vào agent session
- **Không production-ready**: no async, no persistence across process restart, no concurrent access handling

## So sánh với các tools khác

| | A-mem | agentmemory | Honcho | Mem0 |
|---|---|---|---|---|
| **Evolution** | LLM bidirectional | LLM unidirectional + versioning | Dreamer async | Không có |
| **Graph** | Implicit links | Explicit + graph search | Peer graph | Không |
| **LLM per add** | Có (mỗi add) | Không (batch consolidate) | Không (async queue) | Không |
| **Neighbor update** | Có ← unique | Không | Không | Không |

## Pattern có thể học cho Smart Memory

### Pattern 1: Bidirectional Influence khi store (★★★★)

Khi store memory mới, không chỉ hỏi "memory này link đến ai?" mà còn hỏi "memory này làm thay đổi context của memories hiện có như thế nào?". Smart Memory có thể implement nhẹ hơn: thay vì update_neighbor tức thì, queue lại để batch process.

### Pattern 2: Keywords + Context + Tags là bộ 3 semantic (★★★)

A-mem extract 3 thứ này từ mọi memory qua LLM. Cho phép search không chỉ theo content mà theo semantic concepts (keywords), domain (context), và classification (tags). Smart Memory nên enforce 3 fields này trong schema.

### Pattern 3: LLM cho ambiguous cases, heuristics cho routine (★★★)

A-mem gọi LLM mỗi add — quá expensive. Pattern đúng hơn: dùng similarity threshold. Nếu similarity > 0.85 → auto-update (heuristic). Nếu 0.6-0.85 → LLM decides. Nếu < 0.6 → store mới mà không cần LLM.

## Mức độ phù hợp với Smart Memory
- **Kế thừa**: bidirectional influence concept, semantic triple (keywords+context+tags), neighbor expansion trong search
- **Không kế thừa**: LLM-per-add pattern (quá expensive), destructive consolidation, implicit graph
