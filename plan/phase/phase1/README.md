# Phase 1: Core MVP

Phase 1 tập trung vào câu hỏi thực thi: làm tối thiểu những gì để chứng minh Smart Memory thật sự giúp agent nhớ đúng context cũ mà không bắt user nhắc lại.

## Kết luận tính khả thi

Phase 1 khả thi nếu scope được giữ nhỏ. Không nên bắt đầu bằng web app, hook daemon, merge wizard, graph lớn, hay multi-agent adapter. Những phần đó đều có giá trị, nhưng chưa cần để chứng minh core loop.

Core loop cần chứng minh là:

```text
user/agent store memory
  -> ghi vào external canonical store
  -> query lại được nhanh
  -> trả context ngắn cho agent
  -> render Markdown cho user kiểm chứng
```

Nếu loop này chạy tốt, các phase sau mới đáng đầu tư.

## Design mặc định của Phase 1

Phase 1 nên dùng mô hình outsider store làm mặc định:

```text
repo của user:
  không có file Smart Memory

global registry:
  ~/.smart-memory/registry.sqlite

project store:
  ~/.smart-memory/projects/<project_id>/memory.sqlite
  ~/.smart-memory/projects/<project_id>/rendered/
```

Không tạo `.smart-memory.config.json` trong project ở default mode. Điều này quan trọng vì nhiều project công ty không muốn thêm file hoặc folder không liên quan vào repo, kể cả đã gitignore.

Hybrid config chỉ là opt-in:

```text
smem init --write-config
```

## Mục tiêu MVP

Phase 1 đạt MVP khi làm được các việc sau:

1. Tạo hoặc attach project memory từ một workspace hiện tại.
2. Lưu record có cấu trúc vào canonical store.
3. Liệt kê memory theo project.
4. Truy vấn memory bằng keyword và metadata cơ bản.
5. Sinh context ngắn cho agent.
6. Render Markdown đọc được cho user.
7. Không ghi gì vào repo nếu user không yêu cầu.

## Những lệnh CLI tối thiểu

Phase 1 chỉ cần một CLI nhỏ:

```bash
smem init
smem init --store /custom/path
smem attach --project-id <id>
smem status
smem store --type decision --title "..." --content "..."
smem store --type context --content "..."
smem list
smem recall "query"
smem context
smem render
```

Ý nghĩa:

- `init`: tạo project id, store folder, và registry mapping cho current working directory.
- `init --store`: cho phép user chỉ định outsider path.
- `attach`: gán workspace hiện tại vào project memory đã có.
- `status`: cho biết workspace đang map vào project nào.
- `store`: ghi memory record.
- `list`: xem records gần đây.
- `recall`: tìm thông tin cụ thể.
- `context`: trả context compact cho agent.
- `render`: sinh Markdown derived view.

## Schema tối thiểu

Không cần schema quá rộng ở phase 1. Chỉ cần đủ để truy vấn và render:

```json
{
  "id": "mem_uuid",
  "project_id": "proj_uuid",
  "scope": "local",
  "type": "decision",
  "title": "Outsider store as default",
  "content": "Default mode does not write any file into the user's repo.",
  "tags": ["storage", "mvp"],
  "status": "active",
  "created_at": "2026-08-01T00:00:00Z",
  "updated_at": "2026-08-01T00:00:00Z",
  "source": {
    "kind": "manual",
    "agent": "codex"
  }
}
```

Types nên giữ ít:

- `decision`: quyết định đã chốt.
- `context`: bối cảnh dự án.
- `todo`: việc còn dở hoặc open loop.
- `preference`: quy ước/user preference.
- `error`: lỗi đã gặp và cách xử lý.
- `note`: ghi chú thường.

Chưa cần lưu raw transcript. Phase 1 nên ưu tiên memory do agent/user chủ động ghi, vì dữ liệu sạch hơn và dễ audit.

## Registry tối thiểu

Registry cần giải quyết bài toán mất mapping khi không có file trong repo.

```json
{
  "project_id": "proj_uuid",
  "project_name": "ai-research",
  "current_paths": ["/home/light/workspace/ai/ai-research"],
  "previous_paths": [],
  "store_path": "~/.smart-memory/projects/proj_uuid",
  "created_at": "2026-08-01T00:00:00Z",
  "last_seen_at": "2026-08-01T00:00:00Z"
}
```

Rủi ro chính là mất UUID hoặc registry. Phase 1 xử lý bằng các lệnh:

```bash
smem list-projects
smem attach --project-id <id>
smem scan --store ~/.smart-memory/projects
```

`scan` đọc các project store hiện có và rebuild registry ở mức cơ bản.

## Retrieval tối thiểu

Phase 1 chưa cần embedding. Truy vấn có thể dùng SQLite FTS hoặc keyword search đơn giản.

Ưu tiên ranking:

1. Đúng `project_id`.
2. `status = active`.
3. Match title/tags/type trước content.
4. Record mới hơn được ưu tiên nhẹ.
5. `decision`, `todo`, `context` ưu tiên hơn `note`.

Lý do: MVP cần nhanh, offline, ít phụ thuộc, và dễ debug.

## `context` output cho agent

`smem context` nên trả về một đoạn ngắn, không dump toàn bộ database:

```text
Project: ai-research

Core decisions:
- Default storage is outsider store; do not write files into company repos unless user opts in.
- SQLite is canonical store for phase 1; Markdown is derived render.

Open loops:
- Define phase 1 CLI boundaries.
- Decide whether YAML import belongs in phase 1 or phase 2.

Useful recall keys:
- storage mvp
- outsider store
- phase 1 cli
```

Đây là điểm tạo hiệu quả sớm nhất: agent vào phiên mới có thể gọi một lệnh và hiểu đúng project đang đi hướng nào.

## Markdown render trước UI

Phase 1 chưa cần web. `smem render` có thể sinh Markdown:

```text
rendered/
  index.md
  decisions.md
  context.md
  open-loops.md
  records/
    <memory-id>.md
```

Markdown là derived output. User có thể đọc để kiểm chứng, nhưng source of truth vẫn là SQLite.

Nếu cho sửa Markdown ở phase 1 thì phải có import lossless hai chiều, việc này dễ làm scope phình. Vì vậy phase 1 nên chỉ render read-only. Edit qua CLI trước.

## Không làm trong Phase 1

Các phần này nên để sau:

- Web UI.
- Hook daemon.
- SessionStart injection.
- Auto LLM extraction từ transcript.
- Merge wizard.
- Cross-project semantic merge.
- Smart Macro-Graph đầy đủ.
- Vector search.
- Cloud/team sync.
- Obfuscation/build-first distribution.

Nếu đưa vào phase 1, MVP sẽ mất trọng tâm và khó biết core memory loop có thật sự hiệu quả hay không.

## Tiêu chí hoàn thành

Phase 1 được xem là xong khi có thể demo một luồng như sau:

1. Đứng trong repo bất kỳ.
2. Chạy `smem init` mà repo không xuất hiện file mới.
3. Store 5-10 records về decision/context/todo.
4. Chạy `smem context` và nhận summary ngắn, đúng trọng tâm.
5. Chạy `smem recall "outsider store"` và tìm được decision liên quan.
6. Chạy `smem render` và mở Markdown để đọc lại records.
7. Di chuyển repo sang path khác, chạy `smem attach`, memory vẫn dùng lại được.

Đây là MVP đủ tốt để thấy hiệu quả thật: giảm việc user phải nhắc lại design cũ, nhưng chưa gánh complexity của automation.

## Đề xuất thứ tự build

1. Storage layout và registry.
2. `init`, `status`, `attach`, `list-projects`.
3. Memory schema và `store`.
4. `list` và `recall`.
5. `context` compact output.
6. `render` Markdown read-only.
7. Manual demo với chính project này.

Sau bước 7 mới nên bàn tới phase 2.
