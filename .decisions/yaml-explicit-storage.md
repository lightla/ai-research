# Decision: Agent viết YAML trực tiếp — không dùng background LLM extraction

**Status:** Approved  
**Date:** 2026-06-05

---

## Quyết định

Memory không được extract tự động từ hook payload bằng LLM background job.  
Thay vào đó: agent chủ động viết YAML vào `pending.yml` khi cần lưu. `smem load` import vào canonical store.

**Format:** YAML (không phải JSON, không phải Markdown).

---

## Lý do

**Background LLM extraction có 3 vấn đề:**
1. Tốn tiền — mỗi extract là 1 API call
2. Không deterministic — LLM có thể extract sai hoặc bỏ sót
3. Phụ thuộc vào kết nối mạng — không hoạt động offline

**Agent-writes-YAML giải quyết cả 3:**
1. $0 — agent đang chạy đã là LLM, viết YAML là output, không phải call thêm
2. Chính xác — agent biết chính xác cần lưu gì
3. Offline được — chỉ cần Write file

**Tại sao YAML thay vì JSON:**
- Ít verbose hơn cho arrays và nested structures
- Multiline content tự nhiên (không cần escape `\n`)
- Dễ đọc, dễ viết cho agent và human
- Token-efficient hơn JSON cho cùng một lượng data

---

## Schema tối giản

```yaml
- type: decision | preference | instruction | event | fact | error_resolved
  content: "..."        # required
  keywords: [k1, k2]   # optional
  topic: slug           # optional, dùng cho spine grouping
```

`smem load` tự bổ sung: id (ULID), project_id, created_at, decay_rate từ type mapping.

## Ràng buộc lossless — Single Source of Truth

**Mọi field trong file phải map 1-1 vào smem record. Không được mất thông tin.**

```
File YAML  →  smem record          Ghi chú
─────────────────────────────────────────────────────────
type       →  type                 bắt buộc, validate enum
content    →  content              bắt buộc
keywords   →  keywords             optional, default []
topic      →  topic                optional, default null
           →  id                   smem sinh (ULID)
           →  created_at           smem sinh (timestamp)
           →  decay_rate           derived từ type, không do user set
           →  project_id           từ .smart-memory.config.json
```

Fields smem tự sinh (`id`, `created_at`, `decay_rate`, `project_id`) là metadata — không phải mất mát vì chúng không có trong nguồn gốc.

**Export phải reversible:**
```
smem export → YAML → smem import = kết quả giống hệt
```

smem export phải include `id` và `created_at` để round-trip không mất thông tin. Khi import file có sẵn `id` → dùng lại (không sinh mới). Khi import file không có `id` → sinh mới.

---

## Trade-off

**Mất:** memory không tự động capture khi agent quên viết YAML  
**Được:** 0 LLM cost, offline-capable, chính xác, đơn giản

**Khi nào agent viết YAML:**
- Khi user yêu cầu lưu
- Khi agent ra quyết định kiến trúc quan trọng
- Cuối session: session summary
- Khi fix bug có ý nghĩa
