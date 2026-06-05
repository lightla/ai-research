# SimpleMem

**Repo:** https://github.com/aiming-lab/SimpleMem  
**Stack:** Python, LLM-based extraction  
**License:** MIT

---

## Claim vs thực tế

| Claim | Thực tế |
|---|---|
| 30x token reduction | **Fake** — không có benchmark đo token, code comment ghi `# token counting disabled` |
| Compression-first | LLM-based extraction, không phải algorithmic compression |
| EvolveMem self-improving | **Thật** — iterative retrieval improvement có implement |
| MCP compatible | **Thật** — 8 MCP tools đầy đủ schema |

---

## EvolveMem — có thật

`EvolutionEngine.evolve()` chạy N rounds (default 5):
1. Extract memories
2. Evaluate retrieval accuracy (LLM-as-judge)
3. Diagnose failures
4. Adjust `RetrievalConfig` (semantic_top_k, keyword_top_k, structured_top_k)

Học từ retrieval failures để tune config — đây là điểm thú vị duy nhất.

---

## MCP integration — có thật

`/cross/api_mcp.py`: MCPToolRegistry với 8 tools:
`cross_session_start/message/tool_use/stop/end/search/context/stats`

---

## Code quality

✅ Modular architecture, type hints, async/sync compatibility  
❌ 30x claim vô căn cứ  
❌ Soft-delete thiếu cascade safety  
❌ MCP duck-typing fragile  

---

## Kết luận

Không đáng học nhiều. Chỉ note: **EvolveMem pattern** (tự tune retrieval config dựa trên failure) là ý tưởng hay về long-term improvement, nhưng phụ thuộc LLM call — không phù hợp với design smem hiện tại.
