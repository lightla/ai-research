# Memori

**Repo:** https://github.com/memorilabs/memori  
**Stack:** Rust core + PyO3 Python bindings  
**License:** Apache 2.0

---

## Core approach: Capture what agents DO

Intercept LLM client calls (OpenAI, Anthropic, Gemini, Bedrock...) → tự động persist structured memories từ tool calls + decisions + outcomes. Không phải memory từ conversation text.

---

## 4 memory categories (không phải 7 như claim)

```
Facts        — objective information, entity-scoped, có embeddings
Preferences  — user choices, opinions
Skills       — abilities, expertise của agent
Attributes   — process-level metadata về agent capabilities
```

Internally dùng semantic triples: **subject-predicate-object** + embeddings → knowledge graph. Auto-dedup mentions.

---

## Storage

3 levels:
- **Entity** (person/user) — facts, fact_embeddings, semantic_triples
- **Process** (agent/program) — attributes  
- **Conversation** — summary

BYODB: tự bring PostgreSQL/CockroachDB hoặc local. Offline được với local connection + Rust embedding engine.

---

## Benchmark

LoCoMo: **81.95% accuracy, 4.97% token footprint** vs full-context baseline.

---

## Code quality

✅ Rust core cho performance, PyO3 bindings  
✅ 12+ test modules, 7 LLM providers, LangChain/Agno/Pydantic AI integrations  
✅ Production-ready  
❌ Cloud mode cần `MEMORI_API_KEY`, BYODB offline cần setup PostgreSQL

---

## Học được cho smem

1. **Semantic triples (subject-predicate-object)** — cách lưu relation chặt hơn free-form text. Ví dụ: `("taskr", "uses", "PostgreSQL")` thay vì "dự án taskr dùng PostgreSQL"
2. **Intercept LLM calls** — approach tự động capture mà smem đã reject (user phải trigger), nhưng pattern intercept interesting
3. **4 categories** đơn giản hơn nhiều type smem đang define — đáng cân nhắc simplify
