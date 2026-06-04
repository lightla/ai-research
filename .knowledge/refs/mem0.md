# Mem0

## Nó là gì
Mem0 là một memory layer cho AI assistant và agent, có cả đường hosted lẫn self-hosted, kèm Python và TypeScript SDK.

## Mô hình lưu trữ và runtime
- Hosted platform API
- Self-hosted server
- SDK cho tích hợp sản phẩm
- Memory client hỗ trợ add, search, update, delete, và các flow quản trị liên quan

## Kỹ thuật từ source code

### Provider Ecosystem — Quy mô thực
- **24 LLM backends**: OpenAI, Anthropic, AWS Bedrock, Azure, Gemini, Ollama, v.v.
- **15 embedding providers**: local + cloud
- **30+ vector store implementations**: Pinecone, Weaviate, Chroma, pgvector, Qdrant, v.v.
- **4 graph DB backends**: Neo4j, Memgraph, FalkorDB, Amazon Neptune
- **5 rerankers**: cross-encoder models

Mọi config class đều dùng **Pydantic v2** — type-safe nhưng verbose.

### Memory Interface (shared Python + TypeScript)
```python
memory.add(messages, user_id=..., agent_id=..., run_id=..., metadata=...)
memory.search(query, user_id=..., limit=10)
memory.update(memory_id, data)
memory.delete(memory_id)
memory.history(memory_id)   # audit trail
```

### Dual Deployment Mode
- **Hosted**: gọi `mem0.ai` API
- **Self-hosted OSS**: local embeddings + local vector store, không cần cloud

## Mô hình retrieval
- Retrieval đa tín hiệu
- Vector search đi cùng keyword search
- Entity linking và temporal reasoning trong thuật toán mới hơn

## Vì sao quan trọng
- Hình dạng API khá chuẩn product-grade
- Là baseline tốt cho một memory layer portable
- Tách bạch client, server, và storage backend khá rõ

## Điểm mạnh
- Developer surface trưởng thành
- Hỗ trợ backend rộng
- Hợp cho product memory và ứng dụng
- Câu chuyện API / SDK rõ ràng
- Có thể là lớp memory service cho app bên ngoài

## Giới hạn
- **Không có memory consolidation**: memories không tự evolve — không có `supersedes`, không có versioning, không có learning loop
- **Generic interface làm hại chuyên biệt hóa**: một API cho cả semantic lẫn structured query → không optimize cho use case nào
- **30+ vector store integrations = technical debt**: cực khó maintain khi upstream change API
- **Không có capture lifecycle**: không hook vào agent session, không tự học từ vận hành
- **Không có memory boundary global/local**: một kho cho tất cả, không phân tách project
- Ít nhấn mạnh delivery context theo chunk hơn `RetainDB`

## Mức độ phù hợp với mục tiêu của bạn
Đây là reference tốt cho lớp external API và chiến lược retrieval.
