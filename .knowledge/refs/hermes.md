# Hermes

## Nó là gì
Hermes là agent shell có built-in bounded memory, session search, toolset, MCP integration, và plugin memory provider bên ngoài.

## Mô hình lưu trữ và runtime
- Built-in memory nằm trong `MEMORY.md` và `USER.md`
- Session history lưu trong SQLite với FTS5
- External memory provider cắm vào cùng hệ agent
- Provider memory chạy song song với built-in memory, không thay thế hoàn toàn

## Cơ chế thực tế đáng chú ý
- Hermes inject built-in memory vào system prompt như một snapshot cố định cho session.
- External provider thêm prefetch, sync, và tool riêng.
- Nghĩa là Hermes là lớp orchestration, không phải canonical store của tất cả memory.

## Vì sao quan trọng
- Đây là ví dụ tốt của layered memory
- Hữu ích như một lớp wrapper và integration point
- Cho thấy cách kết hợp prompt memory nội tại với external memory service

## Điểm mạnh
- Lớp tích hợp thực tế
- Có search qua session cũ
- Abstraction provider rõ
- Hệ tool và skill khá đầy đủ
- Có thể gắn nhiều provider memory khác nhau

## Giới hạn
- Built-in memory vẫn là prompt-injected và có giới hạn
- Không phải một hệ structured memory chuẩn làm nguồn sự thật cuối cùng

## Mức độ phù hợp với mục tiêu của bạn
Hợp làm consumer và integration layer, không hợp làm lõi memory nguồn sự thật cuối cùng.
