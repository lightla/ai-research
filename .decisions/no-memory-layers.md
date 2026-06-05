# Decision: Không dùng Memory Layers — Spine → Memory trực tiếp

**Status:** Approved  
**Date:** 2026-06-05

---

## Quyết định

Không implement multi-tier memory layers (ephemeral / working / permanent) như một concept kiến trúc riêng.  
Không implement navigation hierarchy L0 / L1 / L2 (Surface Spine → Mapping Spine → Recall).

Thay vào đó: **Spine → Memory trực tiếp**, với `type` field trên memory record quyết định decay behavior.

---

## Bối cảnh

Trong quá trình thiết kế, có hai ý tưởng về phân tầng được đề xuất:

**Ý tưởng 1 — Memory Layers:**  
Ba tầng lifecycle riêng biệt: ephemeral (session-only), working (decay weeks), permanent (no decay).  
Agent hoặc system gán memory vào tầng khi store.

**Ý tưởng 2 — Navigation Hierarchy:**  
Ba tầng navigate: L0 surface spine (5-8 topics) → L1 mapping spine (3-7 sub-topics/pillar, lazy-built) → L2 recall (memories thực).  
Agent đi từ orient() → focus() → recall() qua 3 bước.

Cả hai xuất phát từ một vấn đề thật: thông tin có lifetime khác nhau và granularity cần được kiểm soát.

---

## Phân tích AI

### Memory Layers

**Cái layers thực sự giải quyết được:**  
wake_up token budget cần biết cái gì luôn include (quyết định kiến trúc) và cái gì decay (bug fix hôm qua). Nếu không phân tách, hai loại này compete cùng score formula phức tạp.

**Cái layers không cần concept riêng để giải quyết:**  
Cùng kết quả đạt được bằng `type` field + `decay_rate` cố định:
- `type=decision` → `decay_rate=0` (vĩnh viễn)
- `type=event` → `decay_rate=0.3` (fade sau vài tuần)

Đây là đúng thứ ICM đã làm với `importance: critical/high/medium/low`. Gọi là "layer 3" hay "importance=critical" là cùng một thứ. Thêm tên "layer" không thêm capability, chỉ thêm một concept mà agent và user phải hiểu.

**Điểm thực sự mới và có giá trị duy nhất:** flag `ephemeral: true` — session context không nên persist. Không cần gọi đây là "Layer 1". Chỉ cần một flag trên memory record.

**Kết luận:** Memory layers vi phạm tiêu chí đơn giản và rõ ràng. Không thêm capability. Loại bỏ.

---

### Navigation Hierarchy L0/L1/L2

**Cái L1 (mapping spine) thực sự làm:**  
`focus('architecture')` → trả về sub-topics → agent chọn → rồi mới recall.

**Cái L1 không cần để đạt được:**  
`focus('architecture')` → trả thẳng memories → agent tự narrow bằng `recall('architecture storage decisions')` nếu cần. Kết quả tương đương, ít bước hơn.

**Chi phí của L1:**  
Lazy build per topic, children_hash invalidation per topic, rebuild triggers riêng, 7-sub-topic cap riêng. Complexity không tương xứng với value.

**Kết luận:** L1 là tier trung gian thêm navigation step mà không giảm noise đáng kể. Loại bỏ.

---

## Giải pháp thay thế

```
orient()              → Spine (5–8 topics, flat) + last_session + usage_guide
focus('architecture') → Memories trong topic (trực tiếp, BM25+vector)
recall(query)         → Cross-topic search

Memory schema:
  type        → bắt buộc, quyết định decay_rate tự động
  ephemeral   → optional flag, nếu true thì không persist
```

Spine có hard cap 8 topics. `type` field có mapping cố định sang decay_rate. Không có "layer" như concept riêng.

---

## Trade-offs

**Mất gì khi không có layers:**  
- Không có tên riêng cho từng "bucket" lifetime → code internal khó đọc hơn một chút
- Nếu sau này cần lifecycle phức tạp hơn (ví dụ: working memory riêng cho agent stateful), phải refactor schema

**Được gì:**  
- API surface gọn: user/agent không cần hiểu "layer" là gì
- Implementation đơn giản hơn: một table, type field, decay_rate derived
- Không thêm abstraction chưa được validate bởi use case thực

---

## Điều kiện để xem xét lại

Nếu một trong các điều sau xảy ra:
1. wake_up quality kém do permanent và working memories compete không kiểm soát được bằng `type` + `decay_rate`
2. Agent cần navigate một topic với 50+ memories mà không có intermediate grouping
3. Use case xuất hiện cần lifecycle khác với decay model hiện tại

→ Mở lại decision này.
