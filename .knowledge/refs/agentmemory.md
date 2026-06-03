# agentmemory

## Nó là gì
agentmemory là một hệ memory bền vững cho coding agent, xây trên iii-engine. Project này xem memory như một service, với hooks, MCP, REST, và iii functions cùng trỏ về một state.

## Mô hình lưu trữ và runtime
- iii-engine là runtime trung tâm
- State nằm trong SQLite file-backed thông qua state module của engine
- Functions được đăng ký tập trung và gọi qua SDK
- MCP có thể proxy toàn bộ server surface, hoặc chạy ở chế độ fallback local nhỏ hơn
- Worker có pidfile riêng để tránh duplicate process khi restart / stop

## Tool surface
Core memory operations:
- `memory_save`
- `memory_recall`
- `memory_smart_search`
- `memory_sessions`
- `memory_export`
- `memory_audit`
- `memory_governance_delete`

Các nhóm mở rộng còn có:
- session / timeline / profile
- graph / relations / temporal graph
- actions / checkpoints / snapshots / leases / routines / signals
- lessons / reflect / working memory / skill extraction
- replay / vision search / file compression / governance

## Cơ chế thực tế đáng chú ý
- `src/state/hybrid-search.ts` không chỉ search theo một tín hiệu; nó trộn BM25, vector, graph, và rerank.
- `src/index.ts` khởi tạo worker, provider, embedding provider, image embedding provider, REST, streams, metrics, viewer, health, và MCP.
- `memory_save` được thiết kế cho insight / decision / pattern, không phải raw conversation dump.
- `memory_smart_search` dùng progressive disclosure, tức là không cố nhồi toàn bộ kết quả vào một response.

## Vì sao quan trọng
- Đây là ví dụ rõ nhất trong nhóm về mô hình “một service, nhiều agent”
- Nó đã có hooks, MCP, và một backend memory dùng chung
- Nó được thiết kế cho capture vòng đời agent, không chỉ note thủ công

## Điểm mạnh
- Tool registry tập trung
- Tool surface lớn
- Capture dựa trên hooks rất mạnh
- Hợp cho shared memory giữa nhiều client
- iii-engine làm runtime model hiện rõ chứ không ẩn
- Retrieval không đơn tuyến mà là hybrid retrieval thật

## Giới hạn
- Surface quá rộng nên khó reason
- Markdown docs không phải lớp lưu trữ thật
- Hệ này mạnh, nhưng không tối giản
- Nếu muốn schema JSON gọn để tự cắm vào hệ riêng thì phải thêm lớp wrapper bên ngoài

## Mức độ phù hợp với mục tiêu của bạn
Rất mạnh cho ý tưởng “một memory server trung tâm”.
Ít phù hợp hơn nếu bạn muốn một format lưu trữ JSON thật gọn, chuẩn schema, làm nguồn sự thật.
