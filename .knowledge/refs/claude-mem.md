# Claude-Mem

## Nó là gì
`claude-mem` là một hệ thống nén và lưu giữ bộ nhớ dài hạn (persistent memory compression) dành riêng cho các Coding Agent CLI (như Claude Code, Gemini CLI, Cursor, Windsurf, OpenCode).

## Mô hình lưu trữ và runtime
- Mô hình Client-Server lai cục bộ (Hybrid Local Client-Server).
- Client là các hook command tích hợp với lifecycle của Agent CLI.
- Daemon process chạy nền quản lý bằng Bun runtime trên port `37777`, quản lý SQLite DB và Chroma Vector DB.
- Cung cấp giao diện Web Viewer thời gian thực tại `localhost:37777`.

## Mô hình retrieval
- Truy hồi đa tầng tiết kiệm token (Progressive Disclosure - 3-Layer Search):
  1. `search`: Chỉ trả về danh mục kết quả kèm ID và độ tương đồng (~50-100 tokens/result).
  2. `timeline`: Lấy dòng thời gian lịch sử xung quanh một ID kết quả để xem bối cảnh trước/sau (~150-300 tokens).
  3. `get_observations`: Chỉ tải nội dung chi tiết đầy đủ cho các ID thực sự cần thiết (~500-1000 tokens/result).

## Kỹ thuật từ source code

### Stack thực tế
- **Express.js** server + **SQLite** (Drizzle ORM) + **Chroma** (local embedded vector DB)
- Daemon chạy bằng **Bun runtime**, spawn riêng khỏi plugin process — có ProcessRegistry tracking
- SKILL.md + operation content được **cache tại boot**, không đọc lại mỗi request

### Progressive Disclosure — 3 tầng thực tế
```
Layer 1: search      → ID + similarity score          (~50-100 tokens/result)
Layer 2: timeline    → context trước/sau kết quả     (~150-300 tokens)
Layer 3: get_observations → nội dung đầy đủ          (~500-1000 tokens/result)
```
Agent chỉ leo lên tầng trên khi thực sự cần — tiết kiệm ~90% token trung bình.

### Hook pipeline
```
SessionStart   → inject context từ memory vào prompt
PostToolUse    → capture tool output, summarize, store observations
SessionEnd     → LLM summarize toàn session → long-term memory
```

### Định danh project
Dùng `git rev-parse --show-toplevel` để lấy Git Root → ổn định hơn path hash, nhưng **không có local config file** làm anchor. Nếu repo không có git hoặc worktree phức tạp → có thể resolve sai.

## Vì sao quan trọng
- Tích hợp rất sâu và tự động hoàn toàn (zero-friction) vào vòng đời vận hành của Agent CLI thông qua lifecycle hooks (SessionStart, PostToolUse, SessionEnd).
- Cung cấp giải pháp tối ưu token cực tốt khi Agent truy vấn ký ức lịch sử.
- Định danh dự án ổn định bằng cách giải quyết Git Root qua `git rev-parse --show-toplevel`.

## Điểm mạnh
- Tự động hóa hoàn toàn, không cần người dùng hay agent thao tác thủ công để lưu trữ.
- Phễu lọc 3 tầng giúp tiết kiệm trung bình 90% lượng token khi Agent truy hồi bộ nhớ.
- Hỗ trợ nhiều adapter cho các Agent CLI phổ biến trên thị trường (Claude Code, Gemini CLI, Cursor, v.v.).

## Giới hạn
- **Thiếu local config file anchor**: lưu global (`~/.claude-mem/`) nhưng chỉ dùng Git Root để định danh — không có UUID làm anchor, project rename/move dễ mất liên kết memory
- **Không có SQLite migration versioning rõ ràng**: schema thay đổi có thể break DB cũ
- **Worker process overhead**: spawn Node process riêng mỗi session — lifecycle cleanup không rõ
- **Không có memory consolidation**: observations không tự evolve hay tạo ra derived insight; chỉ summarize cuối session
- **Knowledge graph phẳng**: dễ rơi vào Hairball Problem khi project lớn (vẽ quá nhiều micro-link file/hàm)
- Phụ thuộc vào việc đọc file logs/transcripts thô của nền tảng để trích xuất tri thức

## Mức độ phù hợp với mục tiêu của bạn
- Rất phù hợp để tham khảo cơ chế **3-Layer Search** tối ưu token và cách tích hợp **Lifecycle Hooks** tự động.
- Cần cải tiến mô hình lưu trữ sang **Hybrid** (sử dụng local config identifier để chống path-drift) và nâng cấp đồ thị lên **Smart Macro-Graph** (chỉ vẽ liên kết Module, Entity, Decision, Constraint) để vượt trội hơn `claude-mem`.
