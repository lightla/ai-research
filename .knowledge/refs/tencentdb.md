# TencentDB-Agent-Memory

**Repo:** https://github.com/TencentCloud/TencentDB-Agent-Memory  
**Stack:** TypeScript, SQLite + sqlite-vec, llama.cpp (GGUF local)  
**License:** Apache 2.0

---

## Kiến trúc 4-tier tự động

```
L0 — Capture:    agent_end hook → ghi JSONL shard theo ngày (records/YYYY-MM-DD.jsonl)
L1 — Extract:    timer/threshold → LLM extract 3 types: persona/episodic/instruction
                 + smart dedup (cosine + keyword overlap vs top-5 candidates)
L2 — Scene:      timer fired sau L1 → LLM synthesis → scene_blocks/{name}.md
L3 — Persona:    global mutex (concurrency=1) → đọc tất cả scene blocks → LLM generate persona.md
```

Hooks tự động hoàn toàn:
- `before_prompt_build` → performAutoRecall() (inject memories vào prompt)
- `agent_end` → performAutoCapture() (L0 record + notify scheduler)
- `gateway_stop` → graceful flush

---

## Mermaid Symbolic STM — thực chất là gì

Không phải core memory feature. Là **context offload layer** tùy chọn:
- Thay vì dump toàn bộ conversation, inject Mermaid diagram tóm tắt task graph
- Bounded bởi `mmdMaxTokenRatio` (default 20% context window)
- Hữu ích cho hội thoại dài, không phải memory persistence

---

## Offline capability

✅ Thật sự offline:
- Local embedding: `embeddinggemma-300m` (768-dim, 300MB GGUF, node-llama-cpp)
- Fallback: FTS5 keyword-only nếu model chưa load xong
- Storage: SQLite + sqlite-vec, không cần external service
- Caveat: lần đầu chạy có thể timeout khi model đang download

---

## Storage schema

```
L0: records/YYYY-MM-DD.jsonl
L1: SQLite table — id, content, type, priority(0-100), scene_name, source_message_ids, timestamps[]
L2: scene_blocks/{name}.md (markdown với metadata header)
L3: persona.md (single file)
```

`MemoryRecord`: priority 0–100, type, scene, source IDs, timestamps array cho merge history.

---

## Code quality

**Mạnh:** Clean separation TdaiCore / HostAdapter, error degradation non-blocking, config 150+ options, graceful shutdown.  
**Yếu:** Chỉ 1 test file, FIXME trong L1 idle polling, không có CI/CD public.  
**Version:** 0.3.6 — pre-1.0 nhưng dùng trong production nội bộ Tencent.

---

## Học được cho smem

1. **sqlite-vec + local GGUF** = offline vector search pattern đã proven
2. **Fallback chain**: vector → FTS5 keyword-only khi embedding unavailable
3. **Timer-based pipeline**: không trigger mỗi event, batch theo threshold/timer
4. **Priority field (0-100)** thay vì categorical importance level — granular hơn
