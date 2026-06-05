# ReMe (Alibaba AgentScope)

**Repo:** https://github.com/agentscope-ai/ReMe  
**Stack:** Python, SQLite-vec, JSONL files  
**License:** Apache 2.0

---

## Core approach: Memory as JSONL files

Source of truth là JSONL files, một file per ngày:
```
memory/YYYY-mm-dd.jsonl   ← 1 message = 1 line
```

Mỗi record:
```python
MemoryNode:
  memory_id: str          # SHA-256[:16]
  memory_type: enum       # PERSONAL | PROCEDURAL | TOOL | IDENTITY
  content: str
  when_to_use: str        # semantic context hint — khi nào nên dùng memory này
  message_time: str
  time_created, time_modified
  ref_memory_id: str      # link to raw history
  author: str             # LLM model name
  score: float            # relevance 0-1
  metadata: dict
```

---

## Incremental summarization checkpoint

`pre_reasoning_hook()` — **manual hook**, phải gọi tường minh trước reasoning step:
- Kiểm tra context size
- Nếu vượt threshold → split messages, trigger background summary task (asyncio)
- `_compressed_summary` string được append liên tiếp

Không auto-capture. Developer tự integrate.

---

## Cross-agent sharing

Minimal — afterthought, không phải design pattern rõ:
- `memory_target_type_mapping`: dict ánh xạ agent name → MemoryType
- Dùng chung vector store (`default`) nhưng retrieval filter theo `memory_target`
- Không có explicit cross-agent sharing layer

---

## Code quality

✅ 70+ test files, type hints 100% (Pydantic), loguru logging, async/await  
✅ 103K LOC, well-modularized  
❌ Hook manual, không declarative  
❌ Không có retention policy  
**Status:** Beta → production-ready transition

---

## Học được cho smem

1. **`when_to_use` field** — context hint cho memory retrieval, agent biết dùng memory này trong tình huống nào. Khác với `keywords` (BM25) — đây là semantic usage hint
2. **JSONL per ngày** thay vì single file — tự nhiên partition theo thời gian, dễ archive
3. **`ref_memory_id`** — link ngược về raw message gốc, giữ provenance mà không store toàn bộ conversation
