# Decision: Không dùng wake_up injection — Agent tự pull khi cần

**Status:** Approved  
**Date:** 2026-06-05

---

## Quyết định

Không inject context tự động vào agent ở SessionStart (không dùng wake_up hook).  
Agent tự quyết định gọi smem tools khi cần, dựa trên những gì user yêu cầu.

---

## Vấn đề với wake_up injection

**Ví dụ thực tế:**

Session trước: làm auth module, lưu memory về JWT, PostgreSQL, User model.  
Session hôm nay: user mở agent, wake_up inject "auth module còn dở, JWT strategy...".  
Nhưng hôm nay user muốn làm payment module — auth chưa xong nhưng bị delay, chưa được ưu tiên hôm nay.

Kết quả: agent nhận context sai, phải xử lý rác trước khi làm việc thực.

**Vấn đề mang tính cấu trúc, không phải edge case:**

- Người dùng làm việc không tuyến tính — mỗi ngày một module khác nhau
- Session hôm qua không predict được hôm nay làm gì
- "Tiếp tục" không có nghĩa là tiếp tục đúng cái session trước đang làm
- Wake_up inject dựa trên "session trước làm gì" — sai assumption

**Wake_up giống ICM anti-pattern:**
- ICM: agent phải chạy ceremony wake_up → recall trước khi làm việc
- Wake_up injection: platform ép inject context agent chưa chắc cần

---

## Giải pháp: Agent-driven pull

Agent được đăng ký smem như MCP tools với description rõ ràng.  
Khi user nói "tiếp tục" hoặc "làm X", agent tự quyết định gọi tool nào.

```
User: "tiếp tục"
→ Agent thấy context chưa rõ → tự gọi smem.orient()
→ Thấy spine + open-loops → hỏi user muốn làm cái nào
→ User chọn → agent gọi smem.focus(topic) hoặc recall(query)
→ Có đúng context cần → làm việc

User: "làm payment module"
→ Agent gọi smem.recall("payment")
→ Không có memory → biết topic mới, bắt đầu fresh
→ Không bị inject sai context về auth từ session trước
```

---

## Trade-off

**Mất:** Context được inject sẵn mà không cần agent gọi  
**Được:**
- Agent không nhận rác không liên quan
- Đúng với thực tế làm việc phi tuyến tính
- Agent query chính xác theo intent của user
- Không có ceremony overhead ở session start

---

## Cơ chế thay thế: smem.guide()

Tool description trong MCP metadata không đủ — giới hạn độ dài, không có ví dụ, agent mới không biết flow.

Cần một tool riêng: **`smem.guide()`** — agent gọi một lần khi chưa biết smem là gì.  
Khác với `orient()` (project context dynamic), `guide()` trả về hướng dẫn sử dụng tĩnh lưu ở `~/.smart-memory/agent-guide.yml`.

```
smem.guide()   → dạy agent CÁCH dùng smem (system-level, gọi 1 lần)
smem.orient()  → cho agent biết project đang có GÌ (project-level, gọi khi cần)
```

Content của guide được lưu trong file riêng, user có thể chỉnh sửa nếu cần.
