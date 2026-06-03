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
- Reasoning bất đồng bộ có thể chậm hơn write
- Ít hợp với điều hướng filesystem/tree quyết định như `OpenViking`
- Ít phù hợp nếu bạn muốn một reader cực đơn giản kiểu JSON chunk

## Mức độ phù hợp với mục tiêu của bạn
Rất hữu ích nếu bạn muốn hệ này càng dùng càng thông minh, không chỉ lưu facts.
