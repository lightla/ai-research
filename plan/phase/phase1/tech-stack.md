# Phase 1 Tech Stack

Tài liệu này chốt công nghệ đề xuất cho Phase 1. Tiêu chí chính không chỉ là hiệu năng, mà là: AI code được ít rác, dễ hiểu, dễ refactor, dễ test, và đủ nhanh cho memory CLI.

## Kết luận

Phase 1 nên dùng:

```text
Language: TypeScript strict
Runtime: Node.js 24+
Package manager: pnpm
CLI framework: commander
Storage: SQLite
DB access: node:sqlite + raw SQL files
Validation: Zod
Build: tsc
Test: Vitest
Markdown render: template Markdown sinh từ records
Web UI: chưa làm trong Phase 1, nhưng để đường cho Next.js ở Phase 2/3
```

Không nên bắt đầu bằng:

- HTML/JS thuần: AI dễ sinh code rác, thiếu boundary, thiếu type.
- Rust toàn bộ: hiệu năng tốt nhưng tốc độ iteration thấp hơn, AI dễ mất nhiều công sửa lỗi ownership/lifetime.
- Next.js toàn bộ ngay từ đầu: tốt cho UI, nhưng Phase 1 là CLI/storage/capture, chưa cần kéo web framework vào core.
- Bun làm runtime mặc định: rất hấp dẫn vì có SQLite built-in, nhưng phân phối CLI cho nhiều máy vẫn nên ưu tiên Node trước.
- ORM-first stack: AI dễ viết query trông đẹp nhưng khó debug khi dính FTS, migration, transaction, hoặc schema drift.

## Nguyên tắc chọn stack cho AI code

Vì project này dự kiến giao phần lớn implementation cho AI, công nghệ phải thỏa mãn các tiêu chí sau:

- Phổ biến lâu năm, có nhiều ví dụ public.
- API rõ, ít magic, ít convention ẩn.
- Lỗi dễ đọc, dễ sửa.
- Có type/schema để AI không bịa shape dữ liệu.
- Khi cần debug, có thể nhìn thẳng vào file/code/query thay vì lần theo framework internals.
- Không phụ thuộc vào ecosystem quá mới hoặc thư viện ít người dùng.

Ưu tiên "boring technology". Hiệu năng cao nhưng AI khó code đúng thì không phù hợp cho MVP.

Nguyên tắc quan trọng nhất:

```text
AI maintainability > maximum performance
```

Không chọn Rust, Bun, framework mới, database layer lạ, hoặc kiến trúc quá tối ưu chỉ vì benchmark tốt. Chỉ chọn khi nó giải quyết bottleneck thật đã đo được. Phase 1 là local CLI + SQLite + Markdown render, nên bottleneck chính gần như chắc chắn không nằm ở ngôn ngữ.

Stack tốt cho project này là stack mà AI có thể:

- đọc nhanh
- sửa đúng
- refactor ít vỡ
- viết test dễ
- tìm ví dụ public nhiều
- không phải nhớ quá nhiều rule framework ngầm

## Vì sao TypeScript strict

TypeScript là điểm cân bằng tốt nhất cho project này:

- AI code tốt hơn JS thuần vì có type/schema giữ form.
- Dễ viết CLI, daemon, hook handler, Markdown renderer.
- Ecosystem Node mạnh cho filesystem, process, SQLite, packaging.
- Dễ chuyển một phần logic sang web UI sau này.
- Dễ review hơn Rust cho giai đoạn thiết kế còn thay đổi nhiều.

Điều kiện bắt buộc:

```text
strict: true
noUncheckedIndexedAccess: true
exactOptionalPropertyTypes: true
moduleResolution: bundler hoặc node phù hợp
```

Không để TypeScript thành JavaScript có type trang trí. Schema/event/memory record phải được type hóa rõ.

## Runtime: Node.js 24+ trước, Bun sau

Node.js 24+ nên là runtime chính của Phase 1 vì có `node:sqlite` built-in, giảm dependency native bên ngoài. Node chính thức dùng cho server, CLI tool, scripts, web app, nên phù hợp với Smart Memory.

Bun có điểm mạnh rất rõ: SQLite built-in hiệu năng cao và chạy TypeScript tiện. Nhưng Phase 1 cần ít rủi ro môi trường hơn. Bun có thể dùng làm lựa chọn sau hoặc adapter performance nếu cần.

Quyết định:

```text
Default runtime: Node.js 24+
Optional future runtime: Bun
```

## SQLite

SQLite phù hợp Phase 1 vì:

- local-first
- không cần server DB
- query nhanh
- single-file store
- hỗ trợ FTS để search keyword
- dễ backup/scan/recover

Canonical store nên là SQLite. Markdown chỉ là derived render.

Schema chính:

```text
registry.sqlite
memory.sqlite per project
events/timeline queue có thể là SQLite hoặc JSONL trước
```

Phase 1 có thể bắt đầu JSONL queue cho hook event vì append nhanh và ít migration. Khi timeline query phức tạp hơn thì chuyển vào SQLite.

## DB Access

Phase 1 không nên dùng ORM mặc định. Dùng `node:sqlite` built-in với SQL file rõ ràng.

Quy tắc:

```text
SQLite binding: node:sqlite
Schema/migration: raw SQL files
Query thường: prepared statements đặt trong repository functions
FTS/migration đặc biệt: raw SQL file
Không viết SQL string rải rác trong code
```

Lý do:

- SQL là kiến thức phổ biến, AI hiểu tốt hơn ORM DSL mới.
- SQLite FTS cần raw SQL, dùng ORM vẫn phải escape sang SQL.
- Migration đọc được trực tiếp, dễ review.
- `node:sqlite` không cần native package ngoài, tránh lỗi install/build binding.
- API sync, nhỏ, hợp với CLI/local store.
- Ít abstraction giúp giảm bug do AI tự chế layer.

Pattern mong muốn:

```text
src/storage/migrations/001_init.sql
src/storage/migrations/002_fts.sql
src/storage/db.ts
src/storage/memory-repository.ts
src/storage/registry-repository.ts
```

Repository function phải che SQL khỏi phần còn lại:

```text
createMemory(input)
listMemories(projectId)
recallMemories(projectId, query)
getProjectByPath(path)
```

Nếu sau này schema lớn hơn, có thể cân nhắc Kysely/Drizzle. Nhưng Phase 1 không cần.

## Validation

Dùng Zod cho input boundary:

- CLI args sau khi parse
- hook event payload
- adapter normalized event
- memory record trước khi store
- config/registry record

Lý do: hook event từ agent là input bên ngoài, không được tin tuyệt đối. Zod giúp AI viết code ít sai shape hơn.

## CLI

CLI nên đơn giản:

```text
smem init
smem status
smem attach
smem store
smem list
smem recall
smem context
smem render
smem hook codex
```

`commander` dễ hiểu, phổ biến, AI code tốt. Không cần chọn `cac` chỉ vì nhẹ hơn; MVP cần dễ maintain hơn là tiết kiệm vài KB.

## Hook handlers

Hook handler không nên import cả app lớn. Nên có entry riêng:

```text
smem hook codex
smem hook claude-code
```

Hook handler chỉ làm:

1. đọc JSON stdin
2. validate bằng Zod
3. normalize event
4. append queue hoặc gửi daemon
5. block `/smem` nếu cần
6. exit nhanh

Không gọi LLM trong hook sync.

## Markdown Render

Phase 1 chưa làm UI. Render Markdown read-only trước:

```text
rendered/index.md
rendered/decisions.md
rendered/context.md
rendered/open-loops.md
rendered/records/<id>.md
```

Dùng template function TypeScript thường. Không cần MDX, React, hay static site generator ở Phase 1.

## Web UI sau này

Khi cần UI, chọn Next.js App Router + TypeScript.

Lý do:

- AI code React/Next tốt hơn HTML/JS thuần.
- Có route/API/UI cùng ecosystem TypeScript.
- Dễ dùng component library sau này.
- Phù hợp dashboard/editor memory.

Nhưng Next.js không nên là core của Phase 1. Core memory package phải dùng được độc lập với web.

## Rust để sau

Rust chỉ nên dùng nếu Phase sau cần:

- PTY proxy rất ổn định
- binary nhỏ
- file locking phức tạp
- daemon lâu dài cần reliability cao

Không nên dùng Rust cho toàn bộ MVP vì làm chậm iteration và tăng độ khó cho AI coding.

## Package structure đề xuất

```text
packages/
  core/       # schema, storage, recall, context, render logic
  cli/        # smem command
  adapters/   # codex, claude-code, antigravity...
  web/        # để sau, Next.js
```

Nếu repo còn nhỏ, có thể bắt đầu single package trước:

```text
src/
  core/
  cli/
  adapters/
  storage/
  render/
```

Chỉ tách monorepo khi code bắt đầu lớn thật.

## Stack chốt cho MVP

```text
Node.js 24+
TypeScript strict
pnpm
commander
Zod
SQLite
node:sqlite
raw SQL migrations
tsc
Vitest
Markdown templates
```

Đây là stack cân bằng nhất cho Phase 1: đủ nhanh, ít rủi ro, AI dễ code, và không khóa đường sang web/daemon/proxy sau này.
