# MemOS (Memory Operating System)

## Nó là gì
MemOS là một **Memory Operating System** — orchestration layer cho memory-augmented AI agents. "OS" không phải là hệ điều hành truyền thống mà có nghĩa: điều phối nhiều MemCube (memory containers) cho multiple users/agents/sessions, quản lý lifecycle memory với states, và implement kernel-like async scheduling via Redis Streams.

## Stack kỹ thuật
- **Graph DB**: Neo4j (TreeTextMemory) + Qdrant/Milvus (vector)
- **Scheduler**: Redis Streams (async task queue)
- **Activation Memory**: KV-cache injection via vLLM/HuggingFace
- **Config**: Pydantic-based, hierarchical MOSConfig
- **Benchmarks**: LoCoMo 75.80%, LongMemEval +40.43% vs OpenAI Memory, PrefEval-10 +2568%

## 4-Layer Memory Architecture

```
L0 / Parametric:   Model weights (LoRA fine-tuning) — WIP
L1 / Activation:   KV-cache & hidden states (runtime, transient)
L2 / Plaintext:    Text/docs/graph nodes (editable, searchable) ← PRIMARY
L3 / Preference:   User preferences & patterns (structured subset)
```

## Core Data Structures

### TextualMemoryItem
```python
TextualMemoryItem {
    id: UUID
    memory: str
    metadata: {
        user_id, session_id,
        status: "activated" | "resolving" | "archived" | "deleted",
        version: int,                      # version tracking
        history: [ArchivedTextualMemory],  # full audit trail
        evolve_to: [str],                  # evolution links
        type, key, confidence, tags,
        source: "conversation" | "retrieved" | "web" | "file",
        visibility: "private" | "public" | "session"
    }
    sources: [SourceMessage]  # provenance tracking
}

SourceMessage {
    type: "chat" | "doc" | "web" | "file" | "system"
    role: "user" | "assistant" | "system"
    content: str  # minimal reproducible snippet
    # extra fields allowed: url, page_no, confidence, etc.
}
```

## Kỹ thuật từ source code

### MemCube — Container Model
```
MemCube:
  ├── TextMemory (primary)
  │    ├── GeneralTextMemory   → Qdrant (simple vector)
  │    ├── TreeTextMemory      → Neo4j + vector (hierarchical graph)
  │    └── PreferenceTextMemory → Milvus (user prefs)
  ├── ActivationMemory         → KV-cache (35%+ token savings)
  ├── ParametricMemory         → LoRA (WIP)
  └── MultiMemCube             → Multi-view aggregation
```

### TreeTextMemory — Node Hierarchy
```
RawFileMemory   (raw chunks)
    ↓ extraction
WorkingMemory   (temp, rapid storage — limit 20)
    ↓ processing
LongTermMemory  (structured knowledge — limit 1500)
    ↓ consolidation
UserMemory      (distilled prefs — limit 480)
```

Auto-reorganize khi size > 80% threshold qua **GraphStructureReorganizer**.

### AdvancedSearcher — Iterative Multi-Channel Search
```python
search(query):
  1. Initial: BM25 + vector → top memories
  2. LLM judge: "can_answer_from_current_memories?"
  3. If NO → generate "retrieval_phrases" (cần tìm gì tiếp?)
  4. Graph traversal: follow edges → expand context
  5. Repeat (max N iterations)

Multi-channel:
  Vector channel (semantic) → BM25 channel (keyword) → Graph traversal → Internet (optional)
  ↓
  RRF + MMR fusion (relevance + diversity)
  ↓
  Reranker (cross-encoder)
```

### Memory Lifecycle — Versioning với Audit Trail
```
CREATED → status="activated"
    ↓
PROCESSED (by MemReader LLM): structured extraction, version++
    ↓
LINKED/EVOLVED: evolve_to[] tracks forward links
    ↓
CONFLICT DETECTED: old version → history[], status="resolving"
    ↓
ACTIVE: status="activated"
    ↓
ARCHIVED: moved to history[], superseded
    ↓
DELETED: soft delete (status="deleted", not physically removed)
```

`history: [ArchivedTextualMemory]` giữ nguyên toàn bộ chain — không mất gì.

### MemScheduler — Async Production Pipeline
```python
chat(query):
  user_message → immediate response (không block)
  ↓
  submit_async_task(query, chat_id) → Redis Streams queue
  ↓
  Background: extract memories → conflict detection → graph reorg → skill promotion
  ↓
  Next chat: benefits from updated memory
```

### MemoryManager — Size-Based Lifecycle
```python
memory_size = {
    "WorkingMemory": 20,
    "LongTermMemory": 1500,
    "RawFileMemory": 1500,
    "UserMemory": 480,
}
threshold = 0.80  # trigger reorganize

add(memories, mode="sync"|"async"):
  → cleanup_working_memory() immediately (sync) hoặc scheduled (async)
  → move high-value items to LongTermMemory
  → consolidate duplicates
```

### Feedback-Driven Skill Crystallization
```
Conversation → memories extracted (L1 trace)
    ↓ monitor rewards
Extract policy patterns (L2)
    ↓ aggregate
World model updates (L3)
    ↓ crystallize high-value
Skills → injected first in next agent run
```

## Điểm mạnh
- **MemScheduler**: Redis Streams cho async processing — không block user response, production-ready
- **Full audit trail**: version + history[] + status, không mất gì khi update/archive
- **Iterative search**: LLM judge "can I answer?" → nếu không thì generate new retrieval phrases → loop. Không chỉ 1-shot search
- **Multi-channel fusion**: Vector + BM25 + Graph + Internet với RRF+MMR
- **Activation Memory**: KV-cache injection → 35%+ token savings
- **Feedback loop**: memories → skills (crystallization)
- **Strong benchmarks**: PrefEval-10 +2568% — đặc biệt mạnh ở preference learning

## Điểm yếu
- **Parametric (LoRA) WIP**: L0 layer chưa hoàn thiện
- **Nhiều backends**: Neo4j + Qdrant + Milvus + Redis — operational complexity cao
- **Không có lifecycle hooks tự động**: agent phải chủ động gọi, không native hooks
- **Không có global/local project boundary**: user-scoped, không project-scoped

## Pattern học cho Smart Memory

### Pattern 1: MemScheduler — Async-First Store (★★★★★)
Mọi store operation nên return ngay, process background. User không đợi embedding + graph update. Áp dụng: `store()` return ID ngay, background job xử lý enrichment.

### Pattern 2: Size-Bounded Memory Tiers (★★★★)
Working (20) → LongTerm (1500) → User (480). Mỗi tier có size limit, auto-promote/demote khi đầy. Thay vì unlimited accumulation, enforce tiers với compaction policy.

### Pattern 3: Iterative Retrieval với LLM Judge (★★★)
Nếu search không đủ → LLM generates thêm retrieval phrases → search lại. Cho phép multi-hop information gathering mà không cần full graph traversal.

### Pattern 4: Source-Aware Provenance (★★★★)
SourceMessage capture provenance minimal: type + role + content snippet. Không store toàn bộ conversation, chỉ reproducible snippet. Kết hợp với `visibility: "private"|"public"|"session"` cho fine-grained access.
