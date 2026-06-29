# Smart Memory — System Design

## Tổng quan

smem là một memory system cho AI agent, hoạt động theo mô hình **reference source** — không ép agent phải nhớ, chỉ cần agent biết có chỗ để tra khi cần. Giống Google: bạn không cần nhớ hết docs, chỉ cần biết tra ở đâu.

---

## Ngôn ngữ & Runtime

**TypeScript + Node.js**

Lý do chọn TypeScript:
- MCP SDK chính thức (`@modelcontextprotocol/sdk`) là TypeScript-first
- Distribution qua `npx smem` — zero install friction cho user
- Web UI viết cùng ngôn ngữ, cùng codebase
- `better-sqlite3` là binding SQLite tốt nhất trên Node (sync, fast, native)
- `sqlite-vec` có npm package sẵn
- Ecosystem embedding model (ONNX/Transformers.js) tốt trên Node

Không dùng Rust vì:
- MCP SDK cho Rust chưa mature
- Distribution phức tạp hơn (cross-compile binary)
- Không cần performance đó — bottleneck là SQLite I/O, không phải CPU

---

## Cấu trúc thư mục source

```
smem/
  src/
    cli/          ← scmem commands (install, init, start, stop, serve)
    daemon/       ← background process, MCP server
    tools/        ← smem.* và sgmem.* tool implementations
    store/        ← storage layer (SQLite, vector, spine cache)
    search/       ← BM25 + vector + RRF merge
    web/          ← web UI server + static assets
    shared/       ← types, constants, utils dùng chung
  dist/           ← compiled output (distribute cái này, không distribute src/)
  package.json
```

---

## Các Layer

### Layer 1 — Config

Không có code logic ở đây, chỉ là file tĩnh.

**Local project config:**
```json
// .smart-memory.config.json (commit vào git)
{
  "project_id": "01911a5c-8bd1-7c20-9f24-7e8ab1fb6aa9",
  "project_name": "taskr"
}
```

**Global guide:**
```yaml
# ~/.smart-memory/agent-guide.yml (user có thể edit)
# Nội dung mà sgmem.guide() trả về cho agent
```

> **Tại sao UUID thay vì hash(path)?**
>
> Nếu dùng hash của đường dẫn thư mục làm ID, khi bạn đổi tên hoặc di chuyển project:
> ```
> /Users/sang/projects/taskr   → hash = "abc123"
> /Users/sang/work/taskr       → hash = "def456"  ← khác rồi → mất toàn bộ memory
> ```
> UUID được sinh một lần khi `scmem init` và lưu trong file config. Dù thư mục đổi tên/chuyển chỗ, UUID không đổi → memory không bị mất liên kết.

---

### Layer 2 — Storage

**Canonical store** — nơi duy nhất data thật nằm.

```
~/.smart-memory/
  agent-guide.yml
  global/
    memories.db          ← SQLite (global bank)
  projects/
    <project-uuid>/
      memories.db        ← SQLite (per-project bank)
```

**Database schema (mỗi `memories.db`):**

```sql
CREATE TABLE memories (
  id          TEXT PRIMARY KEY,        -- UUID7 (giải thích bên dưới)
  type        TEXT NOT NULL,           -- decision | preference | instruction | event | fact | error_resolved
  content     TEXT NOT NULL,
  keywords    TEXT,                    -- JSON array, cho BM25 search
  topic       TEXT,                    -- spine grouping slug
  when_to_use TEXT,                    -- gợi ý cho agent khi nào nên dùng memory này
  ephemeral   INTEGER DEFAULT 0,       -- 1 = chỉ dùng trong session này, không persist
  decay_rate  REAL NOT NULL DEFAULT 0, -- tốc độ "phai" của memory (giải thích bên dưới)
  valid_at    TEXT NOT NULL,           -- khi nào fact này bắt đầu đúng
  invalid_at  TEXT,                    -- NULL = vẫn đang đúng; có giá trị = đã hết hiệu lực
  superseded_by TEXT,                  -- ID của record thay thế (khi quyết định cũ bị đổi)
  project_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- FTS5: full-text search engine built-in của SQLite, dùng cho BM25
CREATE VIRTUAL TABLE memories_fts USING fts5(
  content, keywords, topic,
  content=memories,
  content_rowid=rowid
);

-- Signals: thống kê truy cập, tách riêng để không làm "bẩn" content record
CREATE TABLE memory_signals (
  memory_id    TEXT PRIMARY KEY REFERENCES memories(id),
  access_count INTEGER DEFAULT 0,   -- đã được recall bao nhiêu lần
  last_accessed TEXT,
  weight       REAL DEFAULT 1.0     -- tăng mỗi lần recall, dùng để boost score
);

-- Spine cache: bản đồ topic, pre-computed để trả về nhanh
CREATE TABLE spine_cache (
  slug          TEXT PRIMARY KEY,
  summary       TEXT,
  memory_count  INTEGER,
  last_updated  TEXT,
  children_hash TEXT,               -- giải thích bên dưới
  pinned        INTEGER DEFAULT 0
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  summary      TEXT,
  open_loops   TEXT,                -- JSON array
  created_at   TEXT
);
```

---

#### Khái niệm: UUID7

> **UUID7** (RFC 9562, 2024) là phiên bản UUID mới nhất có thêm tính chất **sắp xếp được theo thời gian** — giữ nguyên format UUID tiêu chuẩn nhưng 48 bit đầu là Unix timestamp milliseconds.
>
> Ví dụ:
> ```
> UUID4: 550e8400-e29b-41d4-a716-446655440000   ← ngẫu nhiên hoàn toàn, không có thứ tự
> UUID7: 01911a5c-8bd1-7000-9f24-7e8ab1fb6aa9   ← 12 ký tự đầu là timestamp ms
>        ^^^^^^^^                               ← sort lexicographically = sort by time
> ```
>
> Tại sao dùng UUID7 thay vì ULID?
> - Cùng tính chất time-sortable như ULID: `ORDER BY id` = order by thời gian tạo
> - Là **RFC chuẩn** (RFC 9562 tháng 4/2024) — tooling, DB support tốt hơn
> - Format UUID tiêu chuẩn (8-4-4-4-12): tương thích với mọi UUID validator, DB UUID column
> - Library `uuidv7` nhỏ gọn, hoặc dùng `uuid` package v10+ có sẵn `uuidv7()`
> - Không cần lib riêng như ULID
>
> Trong smem, mỗi memory record có UUID7 làm ID:
> ```
> 01911a5c-8bd1-7c20-...  → memory tạo lúc 9:00
> 01911a5c-9f34-7a11-...  → memory tạo lúc 9:01   ← sort lexicographically = mới hơn
> ```

---

#### Khái niệm: Decay Rate (tốc độ phai)

> **Decay** là khái niệm memory "phai dần" theo thời gian nếu không được dùng, giống như trí nhớ con người.
>
> Ví dụ thực tế:
> - "Hôm nay fix bug null pointer ở auth.ts" → thông tin này hữu ích trong vài tuần, sau đó không còn quan trọng nữa
> - "Quyết định dùng PostgreSQL" → thông tin này phải giữ mãi mãi
>
> `decay_rate` là tốc độ phai (0 = không phai, càng cao = phai càng nhanh):
>
> ```
> type = decision       → decay_rate = 0     → không bao giờ phai
> type = preference     → decay_rate = 0     → không bao giờ phai
> type = event          → decay_rate = 0.3   → phai nhanh
> type = error_resolved → decay_rate = 0.2   → phai vừa
> type = fact           → decay_rate = 0.1   → phai chậm
> ```
>
> **Cách hoạt động:** khi tính điểm relevance để sort kết quả, memory càng cũ và decay_rate càng cao thì điểm càng thấp → ít được đề xuất hơn. Memory vẫn còn trong DB, chỉ là xuống dưới danh sách.

---

#### Khái niệm: Half-Life (bán phân rã)

> **Half-life** (bán phân rã) là số ngày để một memory giảm còn 50% "trọng lượng" ban đầu.
>
> Khái niệm mượn từ vật lý hạt nhân, nhưng ý nghĩa đơn giản:
>
> ```
> event half_life = 21 ngày
>
> Ngày 0:   weight = 1.0   (100%)
> Ngày 21:  weight = 0.5   (50%)
> Ngày 42:  weight = 0.25  (25%)
> Ngày 63:  weight = 0.125 (12.5%)
> ```
>
> Công thức: `weight = e^(-ln(2) / half_life × age_days)`
>
> Ví dụ với memory "Fix null pointer auth.ts" (half_life = 30 ngày):
> ```
> Sau 1 tuần:  còn 85% → vẫn được đề xuất
> Sau 1 tháng: còn 50% → ít được đề xuất hơn
> Sau 3 tháng: còn 12% → gần như không hiện nữa
> ```
>
> Nhưng với "Dùng PostgreSQL" (half_life = Infinity → decay_rate = 0):
> ```
> Sau 1 năm: vẫn còn 100% → luôn được đề xuất
> ```

---

#### Khái niệm: Ephemeral (tạm thời)

> **Ephemeral** = chỉ tồn tại trong session hiện tại, không persist.
>
> Ví dụ: agent đang debug một vấn đề phức tạp, cần lưu trạng thái trung gian "đang thử approach A, B, C":
> ```yaml
> - type: fact
>   content: "Đang thử approach: dùng Redis pub/sub cho realtime sync"
>   ephemeral: true   ← chỉ dùng trong session này
> ```
>
> Khi session kết thúc, record này tự xóa. Không làm bẩn memory dài hạn của project.

---

#### Khái niệm: valid_at / invalid_at (thời hạn hiệu lực)

> Timestamp thông thường chỉ nói "khi nào fact được ghi lại". Nhưng câu hỏi quan trọng hơn là "khi nào fact này đúng?".
>
> Ví dụ:
> ```
> Tháng 1: quyết định dùng MongoDB
>   valid_at = "2026-01-15", invalid_at = NULL
>
> Tháng 3: đổi sang PostgreSQL
>   → record cũ: invalid_at = "2026-03-10"   ← MongoDB không còn là sự thật
>   → record mới: valid_at = "2026-03-10", invalid_at = NULL
> ```
>
> Agent có thể hỏi "quyết định storage layer hiện tại là gì?" → chỉ trả về record có `invalid_at = NULL`.
>
> Hoặc "hồi tháng 1 dùng gì?" → trả về record có `valid_at <= "2026-01-31"`.

---

#### Khái niệm: Children Hash (cache invalidation)

> **Children hash** là SHA-256 của tất cả memories trong một topic. Dùng để biết khi nào cần rebuild cache.
>
> Ví dụ:
> ```
> Topic "database" có 5 memories → hash = "a1b2c3..."
>
> Agent store thêm 1 memory về database
> → recompute hash = "d4e5f6..."   ← khác rồi
> → rebuild spine cache cho topic "database"
>
> Agent store memory về auth (không liên quan database)
> → hash của topic "database" vẫn là "a1b2c3..."
> → SKIP rebuild, tiết kiệm công
> ```
>
> Không rebuild theo timer ("cứ 5 phút rebuild một lần") — rebuild khi data thực sự thay đổi.

---

#### Khái niệm: Vector / Embedding (tìm kiếm theo ngữ nghĩa)

> **Embedding** là cách biến một đoạn text thành một mảng số (vector), sao cho những text có nghĩa gần nhau thì vector cũng gần nhau trong không gian toán học.
>
> Ví dụ:
> ```
> "Dùng PostgreSQL cho database"  → [0.2, 0.8, -0.1, 0.5, ...]  (384 số)
> "Chọn Postgres làm storage"     → [0.21, 0.79, -0.09, 0.51, ...]  ← gần giống!
> "Implement auth module JWT"     → [-0.3, 0.1, 0.9, -0.2, ...]  ← khác xa
> ```
>
> Khi search "database quyết định gì?":
> - **BM25 (keyword):** tìm memory nào có chứa chữ "database" → miss nếu viết "storage"
> - **Vector (semantic):** tìm memory nào có nghĩa gần với câu hỏi → tìm được cả "storage", "Postgres", v.v.
>
> smem dùng model `all-MiniLM-L6-v2` (~23MB) chạy local trên máy, không cần internet, không tốn tiền API.

---

#### Khái niệm: BM25 / FTS5 (tìm kiếm từ khóa)

> **BM25** là thuật toán tính điểm relevance cho kết quả tìm kiếm từ khóa. Nó là nền tảng của nhiều search engine (Elasticsearch, Solr...).
>
> **FTS5** là full-text search engine built-in của SQLite, implement BM25 sẵn.
>
> Ví dụ:
> ```
> Query: "PostgreSQL performance"
>
> Memory A: "Dùng PostgreSQL cho production, cần ACID"
>   → có "PostgreSQL" → điểm cao
>
> Memory B: "Performance optimization với index B-tree"
>   → có "performance" → điểm vừa
>
> Memory C: "Fix null pointer auth.ts"
>   → không có từ nào → điểm 0, không hiện
> ```
>
> BM25 thông minh hơn LIKE query:
> - Từ hiếm ("PostgreSQL") có trọng số cao hơn từ phổ biến ("dùng")
> - Document ngắn chứa keyword được score cao hơn document dài

---

#### Khái niệm: RRF — Reciprocal Rank Fusion

> **RRF** là cách kết hợp kết quả từ nhiều thuật toán search khác nhau thành một danh sách duy nhất.
>
> Vấn đề: BM25 và Vector search ra 2 danh sách kết quả khác nhau. Làm sao merge?
>
> Không thể cộng điểm trực tiếp vì điểm BM25 (ví dụ: -2.5) và điểm vector (ví dụ: 0.87) có scale khác nhau hoàn toàn.
>
> RRF giải quyết bằng cách **chỉ dùng thứ hạng (rank)**, không dùng điểm số:
>
> ```
> BM25 results:     Vector results:
> 1. Memory A       1. Memory B
> 2. Memory B       2. Memory A
> 3. Memory C       3. Memory D
>
> RRF score (K=60):
>   Memory A = 1/(60+1) + 1/(60+2) = 0.0164 + 0.0161 = 0.0325
>   Memory B = 1/(60+2) + 1/(60+1) = 0.0161 + 0.0164 = 0.0325
>   Memory C = 1/(60+3) + 0        = 0.0159
>   Memory D = 0        + 1/(60+3) = 0.0159
>
> Final order: A ≈ B > C ≈ D
> ```
>
> K=60 là hằng số chuẩn trong literature, giúp giảm ảnh hưởng của top-1 result.

---

#### Khái niệm: Signal Boost (boost theo hành vi sử dụng)

> **Signal** là các số đo về cách memory được sử dụng: bao nhiêu lần được recall, lần cuối được dùng khi nào.
>
> Ý tưởng: memory nào được recall thường xuyên → có nghĩa là thực sự hữu ích → nên được ưu tiên hơn.
>
> ```
> Memory A: "Dùng PostgreSQL"
>   access_count = 12, last_accessed = "hôm qua"
>   → weight = 1.0 + 12 * 0.05 = 1.6   ← boost lên
>
> Memory B: "Install Docker lần đầu"
>   access_count = 0, last_accessed = "3 tháng trước"
>   → weight = 1.0   ← không boost
> ```
>
> Signals lưu trong bảng riêng (`memory_signals`), không lẫn vào content record. Lý do: signals thay đổi mỗi lần query → nếu lưu chung sẽ làm git history bị noisy khi commit.

---

#### Khái niệm: SSV — Space-Separated Values (output format)

> **SSV** là format trả về cho agent: các fields cách nhau bằng space, text có space thì wrap trong `"..."`.
>
> Tại sao không dùng JSON?
>
> ```json
> // JSON: 180 tokens
> [
>   { "slug": "database", "summary": "PostgreSQL, User model", "count": 5 },
>   { "slug": "auth", "summary": "JWT strategy", "count": 3 }
> ]
>
> // SSV: 40 tokens — tiết kiệm ~78%
> slug summary count
> database "PostgreSQL, User model" 5
> auth "JWT strategy" 3
> ```
>
> Agent đọc SSV nhanh hơn và tốn ít token hơn. Input từ agent vẫn dùng YAML vì dễ viết multiline content.

---

#### Khái niệm: Spine (bản đồ topic)

> **Spine** là danh sách các topic chính của project, được tự động sinh từ toàn bộ memories. Giống mục lục của một cuốn sách.
>
> Ví dụ project "taskr" sau 2 tuần làm việc:
> ```
> slug           summary                          count  last_updated
> database       "PostgreSQL, User/Task model"    8      2026-06-10
> auth           "JWT, refresh token strategy"    5      2026-06-09
> api-design     "REST endpoints, error format"   4      2026-06-08
> open-loops     "Payment module chưa làm"        2      2026-06-07
> ```
>
> Hard cap: **tối đa 8 topics**. Nếu clustering ra nhiều hơn → merge các cluster nhỏ lại. Buộc system phải tổng quát hóa thay vì tạo hairball.
>
> **Tại sao quan trọng?**
> Thay vì agent phải đoán keyword để search, agent thấy bản đồ topic trước → biết chính xác nên `focus("database")` hay `recall("auth jwt")`.

---

#### Khái niệm: Lossless Constraint (không mất dữ liệu khi convert)

> **Lossless** = chuyển đổi format đi rồi về lại phải cho kết quả giống hệt ban đầu.
>
> Ví dụ vi phạm lossless:
> ```
> YAML có field: when_to_use: "khi quyết định storage layer"
> → smem load → import vào SQLite
> → smem export → ra YAML
> → YAML không có field when_to_use nữa   ← MẤT DỮ LIỆU → vi phạm lossless
> ```
>
> Ví dụ đảm bảo lossless:
> ```
> smem export phải include TẤT CẢ fields, kể cả id và created_at
> → smem import với file này → kết quả giống hệt 100%
> ```
>
> Tại sao quan trọng: nếu mất dữ liệu khi round-trip, không thể nói "YAML là single source of truth" — vì import lại sẽ cho DB khác.

---

### Layer 3 — Search

Hai mode:

**`recall_fast` (default):** BM25 FTS5 only, 0 LLM call, <10ms

```typescript
function recallFast(query: string, projectId: string, limit = 10) {
  // FTS5 BM25: tìm keyword trong content, keywords, topic
  const bm25 = db.prepare(`
    SELECT m.*, fts.rank as bm25_score
    FROM memories_fts fts
    JOIN memories m ON m.rowid = fts.rowid
    WHERE memories_fts MATCH ? AND m.project_id = ?
    ORDER BY fts.rank
    LIMIT ?
  `).all(query, projectId, limit * 2)

  return applySignalBoost(bm25).slice(0, limit)
}
```

**`recall_deep` (optional):** BM25 + Vector + RRF merge

```typescript
function recallDeep(query: string, projectId: string, limit = 10) {
  const bm25Results   = getBM25Results(query, projectId, limit * 3)
  const vectorResults = getVectorResults(embed(query), projectId, limit * 3)

  // RRF: merge 2 danh sách bằng rank, không phải score
  return rrfMerge(bm25Results, vectorResults, { K: 60 }).slice(0, limit)
}

function rrfMerge(listA, listB, { K = 60 } = {}) {
  const scores = new Map()
  listA.forEach((item, rank) => {
    scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (K + rank + 1))
  })
  listB.forEach((item, rank) => {
    scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (K + rank + 1))
  })
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score }))
}
```

**Decay scoring:**

```typescript
// Mapping type → half_life (ngày)
const HALF_LIFE: Record<string, number> = {
  decision:       Infinity,   // không bao giờ phai
  preference:     Infinity,
  instruction:    Infinity,
  fact:           60,         // phai 50% sau 60 ngày
  error_resolved: 30,         // phai 50% sau 30 ngày
  event:          21,         // phai 50% sau 21 ngày
}

function decayScore(memory: Memory): number {
  const halfLife = HALF_LIFE[memory.type]
  if (!isFinite(halfLife)) return 1.0   // không phai

  const ageDays = daysSince(memory.created_at)
  const lambda = Math.log(2) / halfLife
  return Math.exp(-lambda * ageDays)    // công thức bán phân rã
}
```

---

### Layer 4 — Daemon

Background process phục vụ MCP tools qua stdio.

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

const server = new Server(
  { name: "smem", version: "1.0.0" },
  { capabilities: { tools: {} } }
)

registerSmemTools(server)    // smem.context, focus, recall, store, load, loops
registerSgmemTools(server)   // sgmem.guide, recall, store, focus, projects

const transport = new StdioServerTransport()
await server.connect(transport)
```

Daemon start bằng `scmem start`, không auto-start. Lý do: tránh race condition khi nhiều agent instance cùng mở.

**Spine rebuild** chạy async sau mỗi `store()`:

```typescript
async function rebuildSpineIfNeeded(projectId: string) {
  const currentHash = computeChildrenHash(projectId)  // SHA-256 của tất cả memories
  const cached = db.prepare('SELECT children_hash FROM spine_cache LIMIT 1').get()

  if (cached?.children_hash === currentHash) return   // data chưa đổi, skip

  // Cluster memories theo semantic similarity
  // LLM (cheap model) sinh slug + summary cho mỗi cluster
  // Update spine_cache + children_hash
}
```

---

### Layer 5 — MCP Tools

**smem.* (project-scoped)** — agent gọi trong session

| Tool | Khi nào agent gọi | Output |
|---|---|---|
| `smem.context()` | User nói "tiếp tục" hoặc cần orient | Spine + last session + open loops |
| `smem.focus(slug)` | Muốn drill vào topic cụ thể | Memories trong topic đó |
| `smem.recall(query)` | Tìm thông tin cụ thể | Top memories theo relevance |
| `smem.store(record)` | User bảo "nhớ cái này" | ID của record mới |
| `smem.load(file)` | Bulk import YAML | Số records đã import |
| `smem.loops()` | Kiểm tra việc còn dở | Open loops list |

**sgmem.* (global-scoped)**

| Tool | Mô tả |
|---|---|
| `sgmem.guide()` | Hướng dẫn sử dụng smem (gọi 1 lần khi agent chưa biết) |
| `sgmem.recall(query)` | Cross-project search |
| `sgmem.store(record)` | Lưu vào global bank |
| `sgmem.projects()` | List tất cả projects đã init |

**Output format — SSV:**

```
# spine
slug summary count last_updated
database "PostgreSQL, User model schema" 5 2026-06-04
conventions "Conventional commits" 2 2026-06-01
open-loops "Auth module, payment chưa làm" 3 2026-06-03
```

**Input format — YAML:**

```yaml
- type: decision
  content: Dùng PostgreSQL, cần ACID transactions
  keywords: [postgresql, database, acid]
  topic: database
  when_to_use: khi quyết định storage layer cho module mới
```

---

### Layer 6 — CLI (scmem)

User gõ terminal. Agent không gọi các lệnh này.

```
scmem install          # Đăng ký MCP + inject one-liner vào config file agent
scmem init             # Tạo .smart-memory.config.json
scmem start            # Khởi động daemon
scmem stop             # Dừng daemon
scmem serve            # Mở web UI tại localhost:37777
scmem export           # Export memories ra YAML
scmem import <file>    # Import YAML vào project hiện tại
```

**`scmem install` inject vào:**

| Agent | File |
|---|---|
| Claude Code | `CLAUDE.md` |
| Cursor | `.cursorrules` |
| Codex | `AGENTS.md` |
| Gemini CLI | `.gemini/config.md` |
| Windsurf | `.windsurfrules` |

Nội dung inject (1 dòng):
```
Dự án này dùng **smem** để quản lý persistent memory dùng chung giữa các agent — gọi `sgmem.guide()` để xem hướng dẫn sử dụng.
```

**Libraries:**
```json
"commander": "^12.x",    // CLI argument parsing
"chalk": "^5.x",         // terminal colors
"ora": "^8.x"            // spinner khi chờ
```

---

### Layer 7 — Web UI

`scmem serve` mở web UI tại `localhost:37777`. Đọc/ghi thẳng vào canonical store — không có state riêng.

**Features:**
- List memories theo spine topics
- Full-text search + semantic search
- Edit memory record → write ngược về SQLite
- Add new memory (form)
- View open loops
- Export ra YAML

**Stack:**
```json
"hono": "^4.x"     // lightweight HTTP server
```

Frontend: plain TypeScript + Vite. Không cần React cho UI đơn giản, hoặc dùng Preact nếu cần components.

**Bidirectional flow:**
```
User sửa trên web → POST /api/memories/:id → write SQLite → SSE push reload
Agent store YAML  → smem load → import SQLite → web auto-refresh qua SSE
```

> **SSE** (Server-Sent Events) là cơ chế server push update xuống browser mà không cần browser poll liên tục. Khi có memory mới, server gửi event → browser tự reload danh sách.

---

## Type → Decay Rate mapping

```typescript
const DECAY_RATE: Record<MemoryType, number> = {
  decision:       0,    // permanent — không bao giờ phai
  preference:     0,    // permanent
  instruction:    0,    // permanent
  fact:           0.1,  // fade chậm — hữu ích lâu dài nhưng không mãi mãi
  error_resolved: 0.2,  // fade trung bình — hữu ích vài tháng
  event:          0.3,  // fade nhanh — "hôm nay làm gì" không cần nhớ mãi
}
```

---

## Package.json (tóm tắt dependencies)

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.x",   // MCP server framework
    "better-sqlite3": "^9.x",              // SQLite binding (sync, nhanh)
    "sqlite-vec": "^0.1.x",               // vector search extension cho SQLite
    "@xenova/transformers": "^2.x",        // local ONNX embedding, không cần API
    "uuidv7": "^0.6.x",                     // UUID7 generation (RFC 9562)
    "js-yaml": "^4.x",                     // parse YAML input
    "commander": "^12.x",                  // CLI commands
    "hono": "^4.x",                        // web UI server
    "chalk": "^5.x",                       // màu terminal
    "ora": "^8.x"                          // spinner
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tsup": "^8.x",                        // build + bundle + minify
    "vite": "^5.x",                        // web UI dev server
    "@types/better-sqlite3": "^7.x",
    "@types/js-yaml": "^4.x"
  }
}
```

**Build tool: `tsup`** — compile TypeScript sang JS, minify, tree-shake. Output vào `dist/`. Chỉ ship `dist/`, không ship `src/` → bảo vệ source code.

---

## Data flow tổng thể

```
User gõ: scmem start
  → daemon khởi động, serve MCP qua stdio

Agent mở session
  → đọc CLAUDE.md, thấy one-liner về smem
  → (lần đầu) gọi sgmem.guide() → nhận hướng dẫn từ agent-guide.yml

User: "tiếp tục"
  → Agent không biết phải làm gì → gọi smem.context()
  → Daemon đọc spine_cache (pre-computed, <10ms) → trả SSV
  → Agent thấy spine: database, auth, open-loops
  → Hỏi user: "Còn auth và payment chưa làm, bạn muốn tiếp tục cái nào?"

User: "làm auth module"
  → Agent gọi smem.recall("auth module")
  → Daemon: BM25 search → signal boost → decay filter → trả top results
  → Agent có context: "JWT, PostgreSQL, User model đã có password_hash"
  → Làm việc với đúng context

User: "nhớ cái này nhé: dùng RS256 cho JWT signing"
  → Agent gọi smem.store({ type: "decision", content: "...", keywords: ["jwt", "rs256"] })
  → Daemon: validate → write SQLite → async rebuild spine

User gõ: scmem serve
  → Web UI mở tại localhost:37777
  → User thấy toàn bộ memories theo topic
  → Sửa 1 record → POST API → write SQLite → SSE refresh → UI cập nhật ngay
```

---

## Lossless constraint

Mọi field trong YAML phải map 1-1 vào SQLite. Export phải reversible:

```
YAML → smem load → SQLite
         ↓
     smem export
         ↓
      YAML mới    ← phải giống hệt YAML gốc (kể cả id, created_at)
         ↓
     smem load
         ↓
      SQLite      ← phải giống hệt SQLite ban đầu
```

---

## Điều không làm

- Không background LLM extraction — agent viết YAML, $0 cost
- Không wake_up injection — agent tự pull khi cần, không inject context sai
- Không auto-start daemon — user chạy `scmem start` một lần, behavior predictable
- Không tier trung gian L1 — spine → memories trực tiếp, ít bước hơn
- Không ship `src/` — chỉ ship `dist/` đã minify
- Không raw markdown dump cho agent đọc — luôn qua tool layer
