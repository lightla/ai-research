# Decision: TypeScript + Node.js For Smart Memory Core

## Status

Approved for Phase 1.

## Context

Smart Memory là tool phục vụ memory cho agent: CLI, storage local, hook adapters, event queue, recall/context, và Markdown render. Project dự kiến được implement chủ yếu bởi AI, nên stack phải tối ưu cho AI code đúng, dễ đọc, dễ maintain, và có nhiều ví dụ public.

Hiệu năng vẫn quan trọng, nhưng Phase 1 là local CLI + SQLite + file render nên bottleneck chính không nằm ở ngôn ngữ. Rủi ro lớn hơn là chọn stack quá mới, quá magic, hoặc quá low-level khiến AI sinh code khó sửa.

## Decision

Chọn stack Phase 1:

```text
Language: TypeScript strict
Runtime: Node.js 24+
Package manager: pnpm
CLI: commander
Storage: SQLite
SQLite binding: node:sqlite
Validation: Zod
Build: tsc
Test: Vitest
Render: Markdown templates
```

Core sẽ viết bằng TypeScript module thường, không dùng framework lớn.

## Why This Stack

TypeScript + Node.js là lựa chọn cân bằng nhất vì:

- AI hiểu và code TypeScript tốt hơn JavaScript thuần.
- Type/schema giúp giảm lỗi shape dữ liệu khi xử lý memory records, hook events, registry, và queue.
- Node.js phổ biến, ổn định, dễ chạy CLI trên nhiều máy.
- Node.js 24+ có `node:sqlite` built-in, tránh native SQLite package ngoài.
- Ecosystem cho CLI, filesystem, process, SQLite, build/test rất đầy đủ.
- Sau này có thể share type/schema với web UI nếu cần Next.js.
- Code dễ review hơn Rust/Java cho giai đoạn design còn thay đổi.

Nguyên tắc chính:

```text
AI maintainability > maximum performance
```

## Rejected Alternatives

### Plain HTML/JavaScript

Không chọn vì AI dễ sinh code rác, thiếu type boundary, khó giữ schema/event nhất quán.

### NestJS

Không chọn cho Phase 1 vì Smart Memory core là CLI/local tool, không phải backend server lớn. NestJS thêm DI/module/controller abstraction không cần thiết cho MVP.

NestJS chỉ cân nhắc sau này nếu có cloud/team server lớn với auth, multi-user, permission, job scheduling phức tạp.

### Python

Python dễ viết CLI, nhưng TypeScript phù hợp hơn vì project có khả năng cần web UI/agent adapters/schema sharing về sau. TypeScript cũng giúp AI giữ contract dữ liệu tốt hơn.

### Java

Không chọn vì quá nặng cho local CLI memory tool và làm iteration chậm.

### Rust

Không chọn làm core Phase 1 dù hiệu năng tốt. Rust chỉ nên dùng sau này nếu có bottleneck thật như PTY proxy ổn định, binary nhỏ, hoặc daemon/file-locking phức tạp.

### Bun

Không chọn làm runtime mặc định vì Node.js phổ biến và ít rủi ro phân phối hơn. Bun có thể cân nhắc sau nếu cần performance hoặc SQLite built-in.

### ORM-first Stack

Không chọn ORM mặc định. Phase 1 dùng `node:sqlite` + raw SQL migrations vì SQL phổ biến, dễ debug, dễ review, phù hợp SQLite FTS, và không cần native package ngoài. ORM có thể cân nhắc sau nếu schema lớn thật.

## Consequences

Good:

- AI dễ code và maintain.
- Ít framework magic.
- CLI có thể build nhanh.
- Storage local nhanh và đơn giản.
- Không có native SQLite dependency ngoài.
- Dễ test từng module.
- Không khóa đường sang web UI sau này.

Trade-offs:

- Không tối ưu binary size như Rust.
- Cần Node.js 24+ runtime vì dùng `node:sqlite`.
- Nếu sau này server/cloud lớn, có thể cần thêm app framework ở layer ngoài.

## Boundary

Quyết định này áp dụng cho Smart Memory core và Phase 1 CLI.

Nếu sau này làm web UI:

```text
apps/web: Next.js + TypeScript
packages/core: vẫn TypeScript framework-free
```

Nếu sau này làm PTY proxy hoặc daemon hiệu năng cao:

```text
packages/proxy-native: có thể cân nhắc Rust
```

Không rewrite core chỉ vì thêm UI/server/proxy.
