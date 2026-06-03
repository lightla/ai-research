# Mem0

## Nó là gì
Mem0 là một memory layer cho AI assistant và agent, có cả đường hosted lẫn self-hosted, kèm Python và TypeScript SDK.

## Mô hình lưu trữ và runtime
- Hosted platform API
- Self-hosted server
- SDK cho tích hợp sản phẩm
- Memory client hỗ trợ add, search, update, delete, và các flow quản trị liên quan

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
- Ít tập trung vào capture lifecycle của agent hơn `agentmemory` hoặc `RetainDB`
- Ít nhấn mạnh delivery context theo chunk hơn `RetainDB`

## Mức độ phù hợp với mục tiêu của bạn
Đây là reference tốt cho lớp external API và chiến lược retrieval.
