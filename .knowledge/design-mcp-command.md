# Design — MCP Commands & CLI

## Output format

Hai consumer khác nhau, hai format khác nhau:

| Consumer | Format | Lý do |
|---|---|---|
| Tool ↔ Tool (machine parse) | JSON / YAML | Typed, reliable, dễ parse |
| Tool → Agent (agent đọc trong context) | PSV | Token-efficient, agent đọc nhanh |

MCP protocol vẫn wrap JSON ở transport layer, nhưng phần `text` content trả về agent là PSV:
```json
{ "type": "text", "text": "slug|summary|count\ndatabase|\"PostgreSQL...\"|5" }
```

**Quy tắc SSV (space-separated + quoted strings):**
- Fields cách nhau bằng space
- Text có space → wrap `"..."`, không có space thì không cần quote
- Header row luôn có
- Nhiều section trong cùng response → dùng `# section_name`
- Keywords/tags list phẳng: `postgresql,database` (không space, không cần quote)

```
# ví dụ
slug summary count last_updated
database "PostgreSQL, User model" 5 2026-06-04
conventions "Conventional commits" 2 2026-06-01
```

Rule đơn giản, agent hiểu ngay — giống shell quoting.

**Input vào tool** (smem.store, smem.load) vẫn dùng YAML — user và agent viết YAML dễ hơn.

---

## Quy ước đặt tên

Pattern `s[scope]mem`:
- `smem`  — project-scoped MCP tools (agent dùng trong session)
- `sgmem` — global-scoped MCP tools + CLI (cross-project, system-level)
- `scmem` — CLI thuần (user gõ terminal, setup & management)

---

## smem — Project-scoped MCP tools

Agent gọi trong session. Luôn đọc `.smart-memory.config.json` để xác định project.

| Tool | Input | Output | Ghi chú |
|---|---|---|---|
| `smem.context()` | — | spine + last_session + open_loops | Gọi khi user nói "tiếp tục" hoặc cần hiểu project |
| `smem.focus(slug)` | slug: string | memories trong topic đó | Drill vào topic từ spine |
| `smem.recall(query)` | query: string | top memories theo relevance | BM25 + vector, project-scoped |
| `smem.store(record)` | type, content, keywords?, topic?, when_to_use? | id của record mới | Gọi khi user bảo lưu |
| `smem.load(file)` | path: string | số records đã import | Bulk import YAML file |
| `smem.loops()` | — | danh sách open loops | Việc còn dở trong project |

### smem.context() — output format (SSV)

```
# spine
slug summary count last_updated
database "PostgreSQL, User model schema" 5 2026-06-04
conventions "Conventional commits" 2 2026-06-01
open-loops "Auth module, payment chưa làm" 3 2026-06-03

# last_session
date summary
2026-06-04 "Implement User model, chốt PostgreSQL"

# open_loops
"Auth module chưa implement"
"Payment module chưa bắt đầu"
```

### smem.focus(slug) — output format (SSV)

```
id type content keywords when_to_use created_at
01J... decision "Dùng PostgreSQL làm database chính" postgresql,database "khi quyết định storage layer" 2026-06-01
01J... event "Tạo User model — id, email, password_hash" user-model,schema "khi implement auth" 2026-06-02
```

### smem.recall(query) — output format (SSV)

```
id type topic content score
01J... decision database "Dùng PostgreSQL làm database chính" 0.95
01J... preference conventions "Conventional commits: feat/fix/chore" 0.72
```

### smem.loops() — output format (SSV)

```
id content topic created_at
01J... "Auth module chưa implement" open-loops 2026-06-01
01J... "Payment module chưa bắt đầu" open-loops 2026-06-02
```

### smem.store() — input schema

```yaml
type: decision | preference | instruction | event | fact | error_resolved
content: "..."           # required — 1-3 câu
keywords: [k1, k2]       # optional — cho BM25
topic: slug              # optional — spine grouping
when_to_use: "..."       # optional — hint cho agent khi nào dùng memory này
ephemeral: false         # optional — true = không persist sau session
```

---

## sgmem — Global-scoped MCP tools + CLI

Dùng cho cross-project operations và system-level. Agent gọi qua MCP, user gọi qua CLI.

| Tool/Command | Input | Output | Ghi chú |
|---|---|---|---|
| `sgmem.guide()` | — | nội dung agent-guide.yml | Gọi lần đầu để học cách dùng smem |
| `sgmem.recall(query)` | query: string | top memories từ tất cả projects | Cross-project search |
| `sgmem.store(record)` | type, content, ... | id | Lưu vào global memory (dùng chung mọi project) |
| `sgmem.focus(slug)` | slug: string | global memories trong topic | Drill vào global topic |
| `sgmem.load(file)` | path: string | số records đã import | Bulk import vào global |
| `sgmem.projects()` | — | list projects đã init | Xem tất cả projects trong registry |
| `sgmem export` | — | file YAML | Export global memory ra file |
| `sgmem import <file>` | path | — | Import YAML vào global memory |

### sgmem.guide() — trả về

Nội dung từ `~/.smart-memory/agent-guide.yml`. User có thể chỉnh sửa file này.

---

## scmem — CLI thuần (user terminal)

User gõ để setup và quản lý hệ thống. Agent không gọi các lệnh này.

| Command | Mô tả |
|---|---|
| `scmem install` | Đăng ký smem/sgmem như MCP server trong config agent. Inject one-liner vào .md file của agent |
| `scmem init` | Tạo `.smart-memory.config.json` trong thư mục hiện tại |
| `scmem start` | Khởi động daemon |
| `scmem stop` | Dừng daemon |
| `scmem serve` | Mở web UI tại localhost (view/search/edit memories) |
| `scmem export` | Export memory của project hiện tại ra YAML |
| `scmem import <file>` | Import YAML vào project hiện tại |

### One-liner inject bởi scmem install

```
Dự án này dùng **smem** để quản lý persistent memory dùng chung giữa các agent — gọi `sgmem.guide()` để xem hướng dẫn sử dụng.
```

Được inject vào:
- Claude Code → `CLAUDE.md`
- Cursor → `.cursorrules`
- Codex → `AGENTS.md`
- ...

---

## Web UI — scmem serve

Đọc từ canonical store, write ngược về canonical store. Không có state riêng.

**Features:**
- List memories theo spine topics
- Full-text search + semantic search
- Edit memory record → write ngược về canonical store
- Add new memory (form)
- View decisions log
- Export ra YAML / Markdown

**Bidirectional:**
```
User sửa trên web  →  write canonical store  →  re-render ngay
Agent store YAML   →  import canonical store  →  hiện trên web
```

---

## Canonical Store — lưu ở đâu

```
~/.smart-memory/
  agent-guide.yml              ← nội dung sgmem.guide()
  global/                      ← global memory bank
    memories.db                ← SQLite + sqlite-vec
  projects/
    <project-uuid>/            ← per-project memory bank
      memories.db              ← SQLite + sqlite-vec
```

Local project chỉ có:
```
.smart-memory.config.json      ← { project_id, project_name }
```

---

## Flow bootstrap cross-agent

```
1. scmem install
   → đăng ký smem + sgmem như MCP
   → inject one-liner vào CLAUDE.md / .cursorrules / AGENTS.md

2. Agent mới mở project lần đầu
   → đọc config file, thấy one-liner
   → gọi sgmem.guide()
   → hiểu cách dùng smem

3. Agent làm việc
   → gọi smem.context() khi cần orient
   → gọi smem.focus() / smem.recall() khi cần thông tin
   → gọi smem.store() khi user bảo lưu

4. User switch agent (Claude → Cursor)
   → Cursor đọc .cursorrules, thấy one-liner
   → gọi sgmem.guide() → self-onboard
   → gọi smem.context() → đúng project memory từ Claude
   → tiếp tục không mất gì
```

---

## Decisions liên quan

- [Không dùng wake_up injection](../decisions/no-wakeup-injection.md)
- [Agent viết YAML trực tiếp](../decisions/yaml-explicit-storage.md)
- [Cross-agent bootstrap bằng một dòng](../decisions/cross-agent-bootstrap.md)
- [Không dùng memory layers](../decisions/no-memory-layers.md)
- [Daemon khởi động thủ công](../decisions/daemon-manual-start.md)
