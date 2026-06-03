# RetainDB

## Nó là gì
RetainDB là một memory infrastructure stack cho AI agent, có runtime local-first, MCP bridge, flow handoff dựa trên filesystem, và thêm lớp server/cloud rộng hơn.

## Mô hình lưu trữ và runtime
- Local runtime có API và viewer
- Dữ liệu local được persist trên đĩa theo kiểu append-only / journal
- MCP bridge có thể chạy trên local runtime
- Server mode thêm Postgres và pgvector
- Local store có JSON store + journal, không phải chỉ là markdown files

## Tool surface
Local MCP tools gồm:
- `context_pack`
- `context_delta`
- `compress_output`
- `code_map`
- `files_sync`
- `files_list`
- `files_read`
- `files_write`
- `remember`
- `recall`
- `session_history`
- `handoff`
- `forget`

## Cơ chế thực tế đáng chú ý
- `context_pack` gom memory + files + code map + compressed tool output thành một pack nhỏ.
- `context_delta` chỉ trả phần thay đổi so với pack trước đó.
- `files_write` vừa ghi append-only note/handoff, vừa đẩy sang memory.
- `remember` / `recall` là lớp memory trực tiếp; `context` là lớp pack/retrieval cao hơn.
- Trong local CLI còn có filter low-signal, embedding hash fallback, transformer embedding tùy chọn, benchmark report và filesystem sync.

## Vì sao quan trọng
- Đây là ví dụ mạnh cho cách delivery context theo token budget
- Nó nghĩ theo pack, delta, và code map thay vì dump nguyên file
- Nó nối file với memory, hữu ích cho workflow handoff giữa agent

## Điểm mạnh
- Read path rất mạnh
- Hợp với local coding agent
- Handoff và session continuity là tính năng chính
- Tool output và file context có thể được compress
- Có cả cơ chế reader lẫn writer khá rõ

## Giới hạn
- Tối ưu hơn cho local-agent workflow so với product-memory generic
- Nặng tính file-oriented hơn là JSON memory schema thuần

## Mức độ phù hợp với mục tiêu của bạn
Đây là reference rất tốt cho phía reader của hệ bạn định làm.
Nếu bạn muốn một chunked agent memory reader, đây là một trong những pattern tốt nhất trong repo.
