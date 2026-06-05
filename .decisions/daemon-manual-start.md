# Decision: Daemon khởi động thủ công — `smem start`

**Status:** Approved  
**Date:** 2026-06-05

---

## Quyết định

Daemon không tự auto-start. User chủ động chạy `smem start` một lần trước khi làm việc.

---

## Lý do

Auto-start daemon khi hook fire tạo ra race condition thực sự khi nhiều agent instance cùng mở. Giải pháp đúng về mặt kỹ thuật (Unix socket bind) thêm complexity không cần thiết cho một vấn đề mà cách đơn giản hơn đã giải quyết được.

User chủ động start một lần — rõ ràng, không có gì ẩn, không có edge case.

---

## Trade-off

Mất: UX "zero friction" (user phải nhớ `smem start`)  
Được: implementation đơn giản, behavior predictable, không có hidden process management
