# Honcho

## Nó là gì
Honcho là memory infrastructure cho stateful agents, mô hình hóa người dùng, agent, nhóm, project, và ý tưởng thay đổi theo thời gian.

## Mô hình lưu trữ và runtime
- Dùng managed service hoặc self-hosted FastAPI server
- Message và event được lưu theo session
- Background reasoning cập nhật peer representations
- Query có thể trả về chat answer, context bundle, search result, hoặc static representation
- Source code cho thấy có cache client và sync/prefetch thread ở lớp plugin tích hợp với Hermes

## Tool surface
MCP server expose tool cho:
- peers
- sessions
- messages
- context retrieval
- representation retrieval
- chat
- kiểm tra queue / processing
- workflow kiểu consolidation

## Kỹ thuật từ source code

### 3 Specialized Internal Agents
Honcho không dùng một LLM layer đơn mà có **3 agent chuyên biệt**:

**Deriver** (`src/deriver/`)
- Trigger: message batch enqueue
- Strategy: MINIMAL — một structured-output LLM call, không phải agentic loop
- Output: explicit conclusions + deductive conclusions từ batch messages

**Dialectic** (`src/dialectic/`) — Tool-using agent, synchronous
- Trigger: `POST /peers/{peer_id}/chat`
- Có **5 reasoning tiers** (minimal → max):
  - `minimal`: chỉ dùng `search_memory` + `search_messages`
  - `max`: full agentic loop với 6 tools
- Đây là lớp "chat" của agent — trả lời câu hỏi thông qua tool use
- **Blocks HTTP**: tool loop là synchronous, dù có configurable timeout

**Dreamer** (`src/dreamer/`) — Consolidation specialist, async/queue
- Trigger: Scheduled via DreamScheduler
- **Surprisal-based prioritization**: chỉ focus conclusions có entropy cao (thay đổi nhiều)
- Specialists: DeductionSpecialist → InductionSpecialist
- **Reasoning Trees**: links premises + downstream conclusions — causality tracking đầy đủ

### Database Design
- Text IDs (nanoid) cho tất cả tables
- **Composite FKs**: `(workspace_name, peer_id, session_id)` → impossible cross-tenant data leak
- MessageEmbedding table tách riêng khỏi Message — decoupling embedding update
- HNSW indexes via pgvector

### Async Pipeline
```
API server → enqueue (instant return)
          → Deriver worker: consumes queue
          → ReconcilerScheduler: syncs pending embeddings + cleans stale queue
```

## Cơ chế thực tế đáng chú ý
- `session.context(...)` trả prompt-ready context, tức là system tự chuẩn bị gói context cho LLM.
- `peer.chat(...)` không chỉ search; nó là lớp reasoning trả lời theo mô hình peer.
- `representation(...)` là static / low-latency artifact, khác với raw search.
- Trong plugin Hermes, Honcho có prefetch thread và sync thread riêng, tức là data path có thể bất đồng bộ và có độ trễ.

## Vì sao quan trọng
- Đây là thiết kế thiên reasoning nhất trong nhóm
- Nó phân biệt raw message với derived representation
- Nó trả context sẵn cho prompt, thay vì chỉ trả blob memory thô

## Điểm mạnh
- Abstraction peer/session khá mạnh
- Background reasoning tạo ra artifact memory cấp cao hơn
- SDK dùng dễ
- Hợp với personalization dài hạn
- Có lớp representation để giảm độ trễ khi cần đọc nhanh

## Giới hạn
- **Reasoning bất đồng bộ**: Dreamer chạy async → memory không update real-time sau conversation, có độ trễ
- **Dialectic blocks HTTP**: tool loop synchronous, tuy configurable timeout
- **Surprisal calculation naive**: dựa trên entropy đơn thuần, không account cho utility của conclusion
- **PostgreSQL + pgvector dependency**: không có local-first path, không offline được
- **High operational complexity**: 3 specialized agents + DreamScheduler + ReconcilerScheduler + queue → expensive to self-host
- Ít hợp với điều hướng filesystem/tree quyết định như `OpenViking`

## Mức độ phù hợp với mục tiêu của bạn
Rất hữu ích nếu bạn muốn hệ này càng dùng càng thông minh, không chỉ lưu facts.
