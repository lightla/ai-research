# Hermes

## Nó là gì
Hermes là agent shell có built-in bounded memory, session search, toolset, MCP integration, và plugin memory provider bên ngoài.

## Mô hình lưu trữ và runtime
- Built-in memory nằm trong `MEMORY.md` và `USER.md`
- Session history lưu trong SQLite với FTS5
- External memory provider cắm vào cùng hệ agent
- Provider memory chạy song song với built-in memory, không thay thế hoàn toàn

## Kỹ thuật từ source code

### Built-in Memory Layer
- `MEMORY.md` và `USER.md` là bounded built-in memory
- Được **inject vào system prompt** như một snapshot cố định khi session bắt đầu
- Bị giới hạn bởi context window — khi MEMORY.md quá dài, phần cuối bị cắt

### Session Search
- SQLite với **FTS5** để search qua session history cũ
- Search là manual — agent phải chủ động gọi tool để tìm kiếm session cũ

### External Provider Pattern
- Provider cắm vào qua interface plugin
- Mỗi provider có prefetch thread + sync thread riêng (học từ Honcho plugin)
- Provider chạy song song với built-in memory, không replace hoàn toàn

### Plugin Architecture (từ retaindb-hermes)
- ACP (Agent Capability Protocol): standardized capability description
- Skills trong `skills/` directory: optional feature toggles
- Cron scheduling trong `cron/` directory

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
- **Built-in memory bị cap bởi context window**: MEMORY.md quá dài → bị cắt, không có phân trang
- **Snapshot injection không dynamic**: inject một lần lúc session start, không update mid-session
- **Lớp orchestration**: không phải canonical store, không nên dùng làm nguồn sự thật cuối cùng
- **Plugin phức tạp**: mỗi external provider cần thread riêng → overhead khi nhiều provider

## Mức độ phù hợp với mục tiêu của bạn
Hợp làm consumer và integration layer, không hợp làm lõi memory nguồn sự thật cuối cùng.
