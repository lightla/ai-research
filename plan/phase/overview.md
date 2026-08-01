# Phase Overview

Tài liệu này chia project Smart Memory thành các phase thực thi được. Mục tiêu là tránh làm một hệ quá lớn ngay từ đầu; mỗi phase phải tạo ra một kết quả có thể dùng, đo, và kiểm chứng.

## Nguyên tắc chia phase

- Phase trước phải tạo nền cho phase sau, nhưng vẫn tự có giá trị.
- Không đưa UI, hook, graph, merge, multi-agent adapter vào quá sớm nếu core memory loop chưa chứng minh hiệu quả.
- Source of truth phải rõ ngay từ phase 1.
- Default storage không ghi gì vào project của người dùng.
- Mọi view như Markdown, web, report đều là derived output, không phải dữ liệu gốc.

## Phase 1: Core MVP

Mục tiêu của phase 1 là chứng minh hệ thống có ích sớm nhất:

1. Tạo project memory ở external store.
2. Lưu memory record có cấu trúc.
3. Truy vấn lại theo project và theo intent đơn giản.
4. Sinh context ngắn cho agent.
5. Render Markdown để user đọc được ngay.

Phase này chưa cần UI web, chưa cần hook daemon, chưa cần vector search, chưa cần merge cross-project.

Kết quả mong muốn: sau vài phiên làm việc, agent có thể gọi tool để biết project này đang có quyết định gì, open loop gì, context gì mà không cần user nhắc lại.

## Phase 2: Usability Layer

Sau khi core loop chạy được, phase 2 tập trung vào trải nghiệm dùng:

- CLI thân thiện hơn: list, attach, detach, status, export, import.
- Markdown renderer tốt hơn: index, topic page, decision page, open-loop page.
- Cơ chế recover khi mất mapping project path.
- Basic edit flow từ Markdown hoặc command line về source of truth.

Kết quả mong muốn: user không cần hiểu schema sâu vẫn có thể xem, sửa, và khôi phục memory.

## Phase 3: Retrieval Quality

Phase 3 nâng chất lượng truy vấn:

- Spine 5-8 topic tự động.
- Focus theo topic.
- Recall theo keyword + metadata filter.
- Có thể thêm embedding/vector search nếu keyword không đủ.
- Ranking dựa trên recency, type, project scope, và trust.

Kết quả mong muốn: agent nhận context đúng hơn, ngắn hơn, ít nhiễu hơn.

## Phase 4: Hooks And Automation

Phase này mới đưa hook daemon vào:

- PostToolUse capture non-blocking.
- SessionStart cache nếu thật sự cần.
- Signal filter để không lưu rác.
- Adapter cho từng agent.

Kết quả mong muốn: hệ thống bắt đầu tự capture decision/error/preference mà không bắt agent ceremony quá nhiều.

## Phase 5: Web And Merge

Phase này làm các tính năng lớn:

- Web UI đọc và sửa memory.
- Merge wizard local/global.
- Provenance, superseded, alias.
- Smart Macro-Graph derived từ records.
- Team/cloud sync nếu cần.

Kết quả mong muốn: user quản lý tri thức ở quy mô nhiều project mà không phá boundary.

## Ranh giới quan trọng

Thiết kế mặc định là outsider store:

- Không tạo file trong repo.
- Không cần `.gitignore`.
- Không yêu cầu project công ty chấp nhận file lạ.
- Mapping nằm trong registry của Smart Memory.

Hybrid local config chỉ là opt-in cho trường hợp team muốn chia sẻ `project_id` qua repo.
