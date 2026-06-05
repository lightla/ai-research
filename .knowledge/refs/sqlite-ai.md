# sqlite-ai

**Repo:** https://github.com/sqliteai/sqlite-ai  
**Stack:** C (SQLite extension) + Python/TypeScript bindings  
**License:** Elastic License 2.0

---

## Thực chất

**Không phải memory system.** Là SQLite extension cho LLM inference — wrap llama.cpp binaries để chạy model local qua SQL query syntax.

```sql
SELECT llm_chat('Explain this error', content) FROM logs;
SELECT llm_embed(content) FROM documents;
```

Hỗ trợ: chat, text generation, embeddings, audio transcription, vision/multimodal.

---

## Liên quan đến CRDT sync

Repo CRDT là **`sqlite-sync`** (khác hoàn toàn). sqlite-ai chỉ là inference layer, không có memory state hay conflict resolution.

---

## Offline capable

✅ Hoàn toàn offline — models load local, không có API call.  
Multi-platform: macOS ARM/x86, Linux, Windows, iOS, Android.

---

## Liên quan đến smem

**Không liên quan trực tiếp** đến memory design. Có thể dùng như embedding engine offline thay thế fastembed, nhưng Elastic License có hạn chế commercial. Không đáng invest thêm thời gian.
