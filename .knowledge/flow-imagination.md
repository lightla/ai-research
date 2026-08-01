# Flow Imagination — Smart Memory trong thực tế

Tài liệu này tưởng tượng cụ thể Smart Memory hoạt động từ góc nhìn người dùng — từ cài đặt đến từng session hàng ngày. Mục tiêu: thấy rõ kết quả trước khi bắt tay build.

---

## Quy ước đọc

| Ký hiệu             | Nghĩa                                                | Chi phí      |
| ------------------- | ---------------------------------------------------- | ------------ |
| ⚡ **Platform hook** | Tự động, agent không biết, không phải tool call      | Miễn phí     |
| 🔧 **Tool**         | Deterministic query/read/write, không LLM            | Miễn phí     |
| 🤖 **LLM job**      | Có LLM call, chạy async background, không block user | Tốn tiền nhỏ |
| 👤 **User**         | Người dùng làm                                       | —            |
| 🧠 **Agent**        | Agent trong session quyết định gọi                   | —            |

Nguyên tắc tốn tiền: **chỉ LLM job background tốn tiền**. Mọi thứ agent gọi trong session (orient, focus, recall, store) đều là tool call — miễn phí, không LLM.

---

## Phần 1: Cài đặt (một lần duy nhất)

```
👤  smem install
    → đăng ký smem như MCP server trong config của agent
    → agent thấy các tools: guide, orient, focus, recall, store, open_loops
    → inject 1 dòng vào .md config file của agent:

      "Dự án này dùng **smem** để quản lý persistent memory dùng chung giữa các agent — gọi `smem.guide()` để xem hướng dẫn sử dụng."

       Claude Code → CLAUDE.md
       Cursor      → .cursorrules (hoặc .md tương đương)
       Codex       → AGENTS.md
       ...

    → bất kỳ agent nào đọc config của mình đều thấy dòng này
    → agent mới vào → gọi smem.guide() → self-onboard, không cần setup thêm

👤  smem init        (chạy trong thư mục project)
    → tạo .smart-memory.config.json
      { "project_id": "uuid-v4", "project_name": "taskr" }
    → tạo ~/.smart-memory/projects/<uuid>/

Xong. Switch agent bất cứ lúc nào — agent mới tự học cách dùng smem.
```

**Validation từ ECC:** ECC đã ship chính xác pattern one-liner inject này cho 7+ harnesses (211k+ GitHub stars, production-proven). `ecc install` inject một dòng vào CLAUDE.md/AGENTS.md/.cursorrules → agent mới đọc config → gọi guide tool → self-onboard mà không cần setup thêm. smem dùng cùng approach.

---

## Phần 2: Daemon — khởi động

```
👤  smem start
    → daemon chạy, serve MCP tools qua socket
    → agent có thể gọi tools bất cứ lúc nào trong session
```

Không có gì xảy ra tự động khi agent mở. Agent mở ra → làm việc ngay.

---

## Phần 3: Demo — Project "taskr" qua 2 session

### Bối cảnh
Project `taskr` — ứng dụng quản lý task. Ngày 1 bắt đầu, ngày 4 quay lại.

---

### Session 1 — Ngày 1 (project mới, chưa có memory)

```
👤  claude   ← user mở agent, không có gì xảy ra tự động

👤  "Mình dùng PostgreSQL cho database nhé, setup schema đi"

🧠  Agent tạo db/schema.sql với bảng users, tasks, tags

👤  "Nhớ lại quyết định này nhé"
    ↑ User quyết định lưu — agent không tự phán xét

🧠  smem.store(type="decision",
               content="Dùng PostgreSQL làm database chính, cần ACID transactions",
               keywords=["postgresql","database"],
               topic="database")
    ← Cơ chế 2: direct tool call — đơn giản, 1 record, tức thì

🔧  smem nhận → validate → assign id/created_at/decay_rate → write canonical store
    → rebuild wake_up cache

👤  "Implement User model, dùng conventional commits từ nay nhé"

🧠  Agent tạo src/models/user.ts

👤  "Cuối session tổng kết và lưu lại mấy thứ quan trọng"
    ↑ User muốn lưu bulk — phù hợp với file YAML

🧠  Agent viết .smart-memory/pending.yml:
    ← Cơ chế 1: file-based — bulk, structured, nhiều records

    - type: event
      content: Tạo User model — id, email, password_hash, created_at
      keywords: [user-model, schema]
      topic: database

    - type: preference
      content: Conventional commits — feat/fix/chore/docs/refactor
      keywords: [git, commits]

    - type: event
      content: "Session 1: setup taskr, PostgreSQL, User model, conventional commits"
      keywords: [setup, session-summary]
      topic: open-loops

🔧  smem load .smart-memory/pending.yml
    → parse YAML, validate schema
    → bổ sung id/created_at/decay_rate cho từng record
    → write vào canonical store
    → rebuild spine + wake_up cache
    → archive → .smart-memory/archive/session-001.yml
```

---

### Session 2 — Ngày 4 (quay lại project, không biết hôm nay làm gì)

**Không có Smart Memory:**
```
👤  "Tiếp tục"
🧠  "Tiếp tục cái gì ạ? Bạn đang làm phần nào?"
👤  phải nhớ lại và giải thích
```

**Với Smart Memory — agent tự pull khi cần:**
```
👤  claude   ← mở agent, không có gì inject tự động

👤  "Tiếp tục"
    ← user không biết mình muốn làm gì cụ thể, hoặc đơn giản muốn orient

🧠  Agent thấy user muốn tiếp tục nhưng chưa rõ context
    → quyết định gọi smem.context()   ← agent tự pull, không bị ép

🔧  smem trả về:
    spine: [
      { slug: "database",    summary: "PostgreSQL, User model schema", count: 2 },
      { slug: "conventions", summary: "Conventional commits",          count: 1 },
      { slug: "open-loops",  summary: "Task model, auth chưa làm",     count: 2 }
    ]
    last_session: "Setup taskr, chọn PostgreSQL, tạo User model"

🧠  Agent đọc spine, thấy open-loops → hỏi user:
    "Theo memory của project, còn Task model và auth module chưa làm.
     Bạn muốn tiếp tục cái nào?"

👤  "Auth module đi"

🧠  gọi smem.focus("open-loops") hoặc smem.recall("auth module")

🔧  Trả về: "Auth module chưa làm, JWT strategy chưa quyết định"

🧠  "Auth module — sẽ dùng JWT với PostgreSQL, User model đã có password_hash.
     Bắt đầu với auth.service.ts?"
```

**Điểm quan trọng:** Nếu hôm đó user không tiếp tục auth mà làm thứ khác:
```
👤  "Làm payment module đi"

🧠  Agent gọi smem.focus("payment") hoặc smem.recall("payment")
    → không có memory liên quan
    → agent biết đây là topic mới, bắt đầu fresh
    → không bị inject sai context từ wake_up về auth module
```

Agent query đúng theo những gì user thực sự cần — không bị preset bởi "session trước làm gì".

---

## Phần 4: Hai cơ chế lưu trữ

**Nguyên tắc:** User quyết định lưu gì. Agent không tự phán xét hay auto-capture.

### Cơ chế 1 — Direct tool call (đơn giản, 1 record)

```
Khi nào dùng: lưu nhanh 1 thứ, user nói "nhớ cái này nhé"

🧠  smem.store(
      type    = "decision",
      content = "Dùng Redis cho session cache, low-latency requirement",
      keywords = ["redis", "cache", "session"],
      topic   = "infrastructure"   # optional
    )

🔧  smem: validate → id + created_at + decay_rate → write → rebuild cache
```

### Cơ chế 2 — File YAML (bulk, structured)

```
Khi nào dùng: lưu nhiều thứ cùng lúc, tổng kết session,
              quyết định phức tạp nhiều aspects

🧠  Agent write .smart-memory/pending.yml (nhiều records)
🔧  smem load pending.yml → import tất cả → archive file
```

### Bảng so sánh

| | Direct tool call | YAML file |
|---|---|---|
| Khi nào | 1 record đơn giản | Bulk / session summary |
| Agent làm gì | Gọi smem.store() | Write file → smem load |
| Overhead | Gần như 0 | Tạo file + 1 load command |
| Phù hợp | "nhớ cái này" | "tổng kết lại hết đi" |

**0 LLM call trong toàn bộ storage pipeline.** Cả hai cơ chế đều là tool call thuần túy.

---

## Phần 5: YAML Schema — cấu trúc đầy đủ

```yaml
# pending.yml — agent append trong session, smem load khi SessionEnd

- type: decision          # decision | preference | instruction | event | fact | error_resolved
  content: >              # required — 1-3 câu, súc tích
    Dùng PostgreSQL làm database chính,
    cần ACID transactions cho order processing
  keywords: [postgresql, database, acid]   # optional — cho BM25 search
  topic: database                          # optional — spine grouping

- type: preference
  content: Conventional commits — feat/fix/chore/docs/refactor
  keywords: [git, commits]
  # topic không bắt buộc — smem tự group vào "conventions" nếu thiếu

- type: error_resolved
  content: >
    Fix null pointer auth.ts line 42.
    Nguyên nhân: user object chưa được validate trước khi access .id
    Fix: thêm optional chaining user?.id
  keywords: [auth, null-pointer, typescript]
  topic: auth-system
```

**smem tự bổ sung khi load:**
- `id` — ULID (sortable theo time, unique)
- `project_id` — từ `.smart-memory.config.json`
- `created_at` — timestamp lúc load
- `decay_rate` — derived từ type (bảng cứng, không LLM)

**Mapping type → decay_rate:**
```
decision       → 0      (permanent)
preference     → 0      (permanent)
instruction    → 0      (permanent)
fact           → 0.1    (fade chậm)
event          → 0.3    (fade vài tuần)
error_resolved → 0.2    (fade trung bình)
```

---

## Phần 6: Chi phí thực tế

**$0 cho toàn bộ memory pipeline.** Không có LLM call nào trong storage hay retrieval.

Chi phí duy nhất: agent tốn token khi viết YAML vào pending.yml — nhưng đây là output của agent đang chạy, không phải call thêm. Cộng thêm ~50-100 tokens/session cho việc viết YAML thay vì không viết gì.

---

## Phần 7: Điều không xảy ra (anti-patterns đã loại)

```
✗  Agent tự quyết định lưu gì mà không có user trigger
✗  Background LLM extract hay classify
✗  LLM call blocking trên đường agent → user
✗  focus() trả về tier trung gian — trả thẳng memories
✗  Memory của project A lẫn sang project B
✗  Thông tin mất khi convert YAML → smem (phải là 100% → 100%)
```
| Hạng mục                    | Số lượng            | Model         | Ước tính              |
| --------------------------- | ------------------- | ------------- | --------------------- |
| Extract facts               | \~8 lần             | haiku / flash | \~\$0.008             |
| Session summary             | 1 lần               | haiku / flash | \~\$0.002             |
| Spine rebuild               | 0–1 lần             | haiku / flash | \~\$0.005             |
| **Tổng background LLM**     | <br />              | <br />        | **\~\$0.015/session** |
| context(), focus(), recall() | bao nhiêu cũng được | không LLM     | **\$0**               |
| wake\_up inject             | mỗi session         | không LLM     | **\$0**               |