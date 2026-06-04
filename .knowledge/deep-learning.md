# Deep Learning — Nền Tảng Thiết Kế Smart Memory

Tài liệu này chắt lọc những ý tưởng hay nhất từ toàn bộ refs để làm nền tảng tham khảo cho tool **Smart Memory**. Không phải tổng hợp mô tả — mà là extraction có chọn lọc: cái gì đáng kế thừa, cái gì cần vứt.

---

## Tiêu Chí Tối Thượng

Smart Memory phải thỏa mãn **6 thuộc tính cốt lõi**, theo thứ tự ưu tiên:

1. **Nhanh** — recall phải trả kết quả trong milliseconds, không chờ LLM call nào trên đường đọc
2. **Ổn định** — memory không bị mất do path drift, project rename, hay session restart
3. **Hiệu quả thật** — agent nhận đúng context cần, không nuốt token vô ích
4. **Layer rõ** — global vs local tách bạch; data vs config tách bạch; raw vs derived tách bạch
5. **Agent tự truy cứu** — không cần nhắc agent phải gọi gì; nếu cần nhắc thì đó là lỗi thiết kế
6. **Không nhắc lại** — thông tin lưu một lần, dùng được mọi session sau mà không cần re-explain

Hai ràng buộc cứng thêm vào:

- **JSON là single source of truth** — mọi read/write đều qua structured record, không qua raw markdown
- **Wrapper/proxy layer bắt buộc** — agent không bao giờ đọc file thô trực tiếp; tool đọc thay, scope thay, nén thay

---

## Phân Tích Theo Từng Tiêu Chí

### Tiêu chí 1: NHANH

**Định nghĩa:** Recall phải trả kết quả trong milliseconds. Không có LLM call nào trên đường đọc của fast path.

| Ref | Học được gì | Vấn đề |
|---|---|---|
| **ICM** | `icm_wake_up`: pure SQLite query + rank + truncate. Không LLM. Sub-10ms. Token budget là clamped hard limit. | Recall thông thường vẫn trigger embedding call nếu embedder có sẵn |
| **claude-mem** | 3-layer funnel: Layer 1 chỉ trả ID+score. Agent quyết định khi nào cần layer sâu hơn. | Daemon phải running, spawn overhead |
| **RetainDB** | `context_delta`: chỉ trả phần thay đổi so với context pack trước. Không re-read toàn bộ. | Phụ thuộc external API |
| **OpenViking** | L0 abstract luôn được load trước (vài chục bytes). L1/L2 lazy. C++ vector engine. | C++ complexity, ít flexibly |
| **agentmemory** | Index persistence: BM25 + vector index snapshot ra disk. Không rebuild từ đầu mỗi query. | Async flush → consistency window |
| **Hindsight** | `Representation` artifact: pre-computed, cached, low-latency. Không search real-time. | LLM dependency để tạo representation ban đầu |
| **Honcho** | Tier `minimal`: giới hạn chỉ 2 tools, giảm round-trips. | Vẫn là agentic loop, blocking HTTP |

**Bài học tổng hợp cho tiêu chí Nhanh:**
- `wake_up` = pattern nhanh nhất: SQLite rank query, không LLM
- `recall_fast` = BM25 FTS5 only (no vector embed call), return top N với Progressive Disclosure Layer 1
- `recall_deep` = thêm vector + graph, optional LLM synthesis — đây là slow path, không default
- Pre-computed `representation` nên được build nền sau mỗi session, không build on-demand
- Token budget cứng (không soft) để tránh overrun

---

### Tiêu chí 2: ỔN ĐỊNH

**Định nghĩa:** Memory không bị mất do path drift, project rename, hay session restart. Dữ liệu phải survive mọi thay đổi môi trường local.

| Ref | Học được gì | Vấn đề |
|---|---|---|
| **PURPOSE.md** | UUID v4 làm project_id, lưu trong `.smart-memory.config.json` ngay trong project. Không derive từ path. | N/A — đây là spec đúng |
| **ICM** | ULID cho memory ID: sortable theo thời gian, collision-free, không cần DB để generate. | Project filter dùng `cwd.file_name()` — fragile |
| **Hindsight** | Bank isolation: mỗi bank có ID riêng, không bị ảnh hưởng khi project move. | Phụ thuộc PostgreSQL, không offline |
| **Mem0** | `memory.history(id)`: mọi thay đổi đều có audit trail, không mất gì. | Generic, không có project boundary |
| **agentmemory** | Memory versioning: `parentId + supersedes[]`. Dữ liệu cũ không bị xóa khi consolidate. | Index race condition khi flush async |
| **claude-mem** | Git Root detection: ổn định trong monorepo, không phụ thuộc absolute path. | Không có fallback khi không có git |
| **RetainDB** | Append-only journal: ghi theo kiểu có lịch sử, dễ replay, không mất state. | API-dependent, không offline |

**Bài học tổng hợp cho tiêu chí Ổn định:**
- **UUID config file** là anchor duy nhất đúng — không derive project_id từ path, tên thư mục, hay git root
- **Immutable write**: mọi update = record mới + soft-delete cũ. Không overwrite bao giờ.
- **ULID cho memory ID**: vừa unique vừa sortable theo time, không cần DB sequence
- **SQLite local**: survive restart, không cần network, không cần daemon (optional daemon cho background tasks)
- File config trong project nên được commit vào git để team share cùng `project_id`

---

### Tiêu chí 3: HIỆU QUẢ THẬT

**Định nghĩa:** Agent nhận đúng phần context cần, không token nào thừa. "Hiệu quả" = precision cao, waste thấp.

| Ref | Học được gì | Vấn đề |
|---|---|---|
| **claude-mem** | 3-layer funnel tiết kiệm ~90% token. Layer 1 chỉ 50-100 tokens/result. Agent tự quyết leo tầng. | Không thể tinh chỉnh token budget per-query |
| **ICM** | `wake_up` token budget cứng: clamp(20, 4000). Rank by importance × recency × weight. Include preferences always. | Budget mặc định 200 token — có thể quá nhỏ |
| **agentmemory** | Progressive disclosure trong `memory_smart_search`. Session diversification: max 3 results/session. | Surface 80+ functions khó reason |
| **OpenViking** | L0 always included, L1/L2 on-demand. Retrieval trajectory visible (có thể debug). | Context database full, không phải memory primitive |
| **RetainDB** | `context_pack` gom memory + files + code map thành một pack nhỏ. `context_delta` chỉ phần thay đổi. | Phụ thuộc external API |
| **Honcho** | 5 reasoning tiers: agent chọn tier phù hợp với độ phức tạp của query. | Tier max là blocking agentic loop |
| **Hindsight** | Entity extraction → search đúng entity, không search toàn văn. Giảm noise. | LLM call để extract entity |

**Bài học tổng hợp cho tiêu chí Hiệu quả:**
- **Progressive Disclosure là bắt buộc** — không dump toàn bộ memory vào prompt bao giờ
- **Token budget là constraint cứng**, không phải guideline. `wake_up` phải truncate, không extend
- **Type-aware recall**: preference và instruction luôn included trong wake_up, không kể weight
- **Recency weighting**: memory mới hơn nên score cao hơn mặc định (decay giảm weight cũ)
- **Session diversification**: giới hạn số results từ cùng một session/topic để tránh echo chamber
- **Typed memory giúp filter chính xác**: "cho tôi xem tất cả decisions" ≠ "tìm kiếm decision"

---

### Tiêu chí 4: LAYER RÕ RÀNG

**Định nghĩa:** Global vs local tách bạch; data vs config tách bạch; raw vs derived tách bạch; slow-path vs fast-path tách bạch.

| Ref | Học được gì | Vấn đề |
|---|---|---|
| **PURPOSE.md** | Global = tri thức nền/quy ước. Local = spec/quyết định cục bộ. Không lẫn. | N/A |
| **ICM** | Memory (decay) vs Memoir/Concept (permanent): hai lifecycle khác nhau, hai table khác nhau. | Không có global/local bank boundary |
| **Hindsight** | Bank isolation: mỗi bank là store riêng, không cross-query ngầm. | Chỉ có 1 bank per user, không per-project |
| **agentmemory** | Scoped consolidation: consolidate chỉ trong boundary của project. | Index locking yếu |
| **claude-mem** | 3-layer funnel: Layer 1 (index), Layer 2 (timeline), Layer 3 (full) — 3 tầng data rõ ràng. | |
| **OpenViking** | L0/L1/L2 là multi-resolution của cùng một data, không phải 3 loại data khác nhau. Rõ ràng. | |
| **Hermes** | Built-in (prompt-injected) vs external provider (pluggable): hai lớp tích hợp tường minh. | Built-in bị cap bởi context window |
| **Honcho** | Raw message vs Derived conclusion vs Cached representation: 3 tầng derived state tách biệt. | Async → không real-time |
| **Understand-Anything** | Code node / Domain node / Knowledge node là 3 nhóm tách biệt trong cùng graph. Không trộn business logic vào code structure. | One-time analysis, không phải continuous learning |

**Bài học tổng hợp cho tiêu chí Layer rõ:**
- **4 lớp tách biệt không lẫn:**
  1. `Config layer`: `project_id`, tên project — không có data thật
  2. `Data layer`: Memory records, Concept records — không có config
  3. `Index layer`: FTS5 index, vector index — derived từ data, rebuild được
  4. `Derived layer`: wake_up pack, representation cache — computed từ data, invalidate khi data đổi
- **Global bank vs Local bank**: khác nhau về write permission, không chỉ scope label
- **Fast path vs Slow path**: fast = SQLite only; slow = + vector embed + optional LLM. Không trộn
- **Data schema phải explicit type**: `Memory.type` field, không để agent infer

---

### Tiêu chí 5: AGENT TỰ TRUY CỨU

**Định nghĩa:** Agent không cần được nhắc phải dùng memory. Nếu cần nhắc → đó là lỗi thiết kế.

| Ref | Học được gì | Vấn đề |
|---|---|---|
| **claude-mem** | Lifecycle hooks tự động: SessionStart inject context, PostToolUse capture, SessionEnd summarize. Zero friction. | Cần hook vào CLI lifecycle cụ thể |
| **Superpowers** | SessionStart inject "meta-skill" dạy agent khi nào invoke skill nào. Quy tắc 1%. | Prompt compliance dependent, không hard |
| **agentmemory** | Hooks + REST + MCP cùng trỏ về một state. Agent có nhiều cách gọi. | Surface 80+ functions quá rộng |
| **ICM** | icm_wake_up compact → inject vào system prompt → agent thấy context ngay. | Vẫn cần agent gọi wake_up thủ công |
| **Honcho** | `session.context()` trả prompt-ready context: system tự chuẩn bị, agent nhận dùng ngay. | Async reasoning delay |
| **RetainDB** | `runTurn()` tự động: retrieve → inject → generate → store. Agent không cần làm gì. | API-dependent, không streaming |

**Anti-pattern cần tránh (từ ICM):**
```
Yêu cầu ToolSearch trước mọi action → icm_wake_up → icm_memory_recall → ...
Nếu agent quên bước nào → toàn bộ context bị miss
```

**Bài học tổng hợp cho tiêu chí Agent tự truy cứu:**
- **SessionStart hook là bắt buộc**: phải inject `wake_up` context vào system prompt tự động, không phụ thuộc agent nhớ
- **PostToolUse hook**: capture khi agent làm gì đó có ý nghĩa, không để agent tự quyết log hay không
- **Tool description phải rõ trigger**: "Use this when you've made a decision" — agent inference từ description, không nhớ rule
- **Fallback graceful**: nếu hook miss, agent vẫn có thể gọi tool thủ công. Nhưng không được thiết kế hệ phụ thuộc vào thủ công
- **MCP tools với description chuẩn**: agent LLM đọc description để tự quyết khi nào gọi — đây là "auto-truy cứu" ở mức tool

---

### Tiêu chí 6: KHÔNG NHẮC LẠI

**Định nghĩa:** Thông tin được lưu một lần, dùng được mọi session sau mà không cần người dùng re-explain. Memory sống qua nhiều session.

| Ref | Học được gì | Vấn đề |
|---|---|---|
| **agentmemory** | Memory versioning: quyết định từ 3 tháng trước vẫn còn, có audit trail, không bị overwrite. | Surface quá rộng, khó biết gì còn relevant |
| **ICM** | Importance levels + decay: critical không bao giờ mất; high decay chậm; low decay nhanh. Phân biệt rõ. | Consolidation xóa history |
| **claude-mem** | SessionEnd summarize: mỗi session được compress thành long-term summary tự động. | Summary chất lượng phụ thuộc LLM |
| **Honcho** | Dreamer async consolidation: surprisal-based → chỉ preserve những gì thực sự thay đổi, không preserve noise. | Async delay, không real-time |
| **Hindsight** | retain/recall/reflect loop: memory được "nâng cấp" thành insight, không chỉ store raw fact. | LLM dependency nặng |
| **agentmemory** | Lessons reinforcement: memory được recall thường xuyên → confidence tăng → sống lâu hơn. | Chỉ hoạt động nếu agent recall đúng |
| **RetainDB** | Handoff: khi session kết thúc, tạo context handoff packet → session mới nhận được. | No offline mode |

**Bài học tổng hợp cho tiêu chí Không nhắc lại:**
- **Dual-tier persistence:**
  - *Ephemeral* (Memory with decay): facts, errors resolved, session context — tự fade sau 30-90 ngày nếu không access
  - *Permanent* (Concept): decisions, preferences, architecture patterns — không decay, chỉ refine hoặc supersede
- **Auto-consolidation có ngưỡng** nhưng KHÔNG xóa originals: khi topic > N entries, tạo summary memory mới, mark originals là `condensed`
- **SessionEnd summary**: mỗi session phải để lại một dấu vết có cấu trúc `{ what_was_done, decisions_made, open_loops, next_session_should_know }`
- **Importance phải được set đúng**: preference = critical (không decay), một session context = medium/low (decay sau vài ngày)
- **Provenance bắt buộc**: mọi memory phải biết nó đến từ đâu (session_id, agent, timestamp) để có thể audit

---

## Extraction Từ Từng Ref

### Từ claude-mem — Progressive Disclosure (★★★★★)

**Pattern học được:** 3-Layer Funnel

```
Layer 1: search       → chỉ trả ID + score            (~50-100 tokens/result)
Layer 2: timeline     → context trước/sau result      (~150-300 tokens)
Layer 3: get_full     → nội dung đầy đủ               (~500-1000 tokens/result)
```

**Tại sao quan trọng:** Agent chỉ leo lên layer cao hơn khi thực sự cần. Tiết kiệm ~90% token trung bình. Đây là cơ chế tiết kiệm token hiệu quả nhất trong tất cả refs.

**Học gì:** Mọi read API của Smart Memory phải có ít nhất 2 tầng — tầng "index" (nhẹ) và tầng "detail" (đầy đủ). Agent tự quyết khi nào leo tầng.

**Vứt gì:** Cơ chế định danh project qua Git Root (fragile). Dùng UUID config file thay thế.

---

### Từ claude-mem — Lifecycle Hooks tự động (★★★★★)

**Pattern học được:**

```
SessionStart   → inject context từ memory vào prompt (không cần agent gọi)
PostToolUse    → capture output → summarize → store (không cần agent gọi)
SessionEnd     → LLM summarize toàn session → long-term (không cần agent gọi)
```

**Tại sao quan trọng:** Tiêu chí số 5 — "agent tự truy cứu" — đòi hỏi không cần nhắc. Hooks tự động là cách duy nhất đảm bảo điều này. ICM thất bại ở đây vì hooks thủ công.

**Học gì:** Smart Memory phải hook vào agent lifecycle mà không đòi agent nhớ gọi tool. Nếu không làm được, phải có một prompt-injection layer tối thiểu ở SessionStart để inject context quan trọng nhất.

---

### Từ agentmemory — Memory Versioning (★★★★★)

**Pattern học được:**

```rust
// Khi consolidate, KHÔNG xóa memory cũ:
new_memory = {
    parentId: old_memory.id,
    supersedes: [old_memory.id, older_memory.id],
    content: "merged insight",
    ...
}
old_memory.status = "superseded"
```

**Tại sao quan trọng:** ICM `consolidate_topic` xóa thẳng tất cả và tạo mới — không có audit trail, không có history. Nếu consolidated memory sai, không thể rollback.

**Học gì:** Mọi update memory phải là immutable write mới + soft-delete cũ. Record phải có `supersedes[]` field. Deletion thực sự chỉ xảy ra khi explicit prune hoặc TTL expired.

---

### Từ agentmemory — Hybrid Search với RRF (★★★★)

**Pattern học được:**

```
Triple stream parallel:
  BM25 (keyword)  → rank list A
  Vector (semantic) → rank list B
  Graph (entity links) → rank list C

Merge bằng Reciprocal Rank Fusion (K=60):
  score = w_bm25 * 1/(60+rankA) + w_vec * 1/(60+rankB) + w_graph * 1/(60+rankC)

Stream nào trả rỗng → weight tự động = 0 (không phải fallback sequential)
```

**Tại sao quan trọng:** Single-stream search miss nhiều trường hợp. BM25 miss semantic. Vector miss exact keyword. Graph miss isolated facts. RRF kết hợp không cần normalize score (chỉ dùng rank).

**Học gì:** Smart Memory nên dùng ít nhất BM25 + vector. Graph expansion (1 hop, discounted) là bonus tốt. RRF là merge function đơn giản nhất và hiệu quả.

---

### Từ agentmemory — Lessons Reinforcement (★★★)

**Pattern học được:**

```
confidence = confidence + 0.1 * (1 - confidence)  // mỗi lần recall/reinforce
recencyBoost = 1 / (1 + daysSinceReinforced * 0.01)
score = confidence * relevance * recencyBoost
```

**Tại sao quan trọng:** Memory được recall thường xuyên tự nhiên nổi lên. Memory không dùng từ từ chìm. Đây là cơ chế decay/reinforce đơn giản nhưng có nghĩa.

**Học gì:** Mọi memory cần có `weight` hoặc `confidence` field tự điều chỉnh theo access pattern. Importance level (critical/high/medium/low) quyết định baseline decay rate.

---

### Từ ICM — icm_wake_up (★★★★★)

**Pattern học được:**

```
Inputs: project_name, max_tokens (200 default), format
Process:
  1. Select critical + high importance memories scoped to project
  2. Always include preferences (global)
  3. Rank by: importance × recency × weight
  4. Truncate to token budget (1 token ≈ 4 chars)
Output: compact markdown block, sẵn inject vào system prompt
```

**Tại sao quan trọng:** Đây là pattern tốt nhất cho tiêu chí "nhanh" và "hiệu quả" tại session start. Không cần LLM call, không cần search. Chỉ cần query SQLite với ranking đơn giản rồi truncate.

**Học gì:** Smart Memory phải có một `wake_up` / `context_pack` API tương tự. Token budget là constraint cứng, không phải soft limit. Format phải compact — không dùng verbose JSON ở đây.

---

### Từ ICM — Dual-Layer: Memory vs Memoir (★★★★)

**Pattern học được:**

```
Memory (decaying):
  - ephemeral facts, decisions, errors resolved
  - weight decreases over time
  - keyword match → vector → graph expansion

Memoir/Concept (permanent):
  - architectural knowledge, domain understanding
  - confidence increases with refinement
  - never decays, only refines or supersedes
```

**Tại sao quan trọng:** Không phải mọi thứ đều decay theo thời gian. "Tại sao chọn SQLite" là quyết định kiến trúc — nó phải tồn tại mãi mãi. "Session hôm nay sửa bug X" có thể decay sau 30 ngày.

**Học gì:** Smart Memory cần 2 loại record tách biệt về lifecycle, không phải chỉ phân biệt bởi importance level.

---

### Từ Honcho — Reasoning Tiers (★★★★)

**Pattern học được:**

```
tier=minimal: chỉ search_memory + search_messages (2 tools)
tier=balanced: thêm get_context, get_representation
tier=max: full agentic loop với 6 tools, có thể gọi nhiều lần

Agent chọn tier dựa trên complexity của query, không phải caller chọn.
```

**Tại sao quan trọng:** Không phải query nào cũng cần full reasoning. "Tìm quyết định về DB" → minimal đủ. "Tổng hợp toàn bộ architectural decisions và đề xuất refactor" → cần tier cao hơn.

**Học gì:** Smart Memory nên expose một `recall_deep` vs `recall_fast` mode. Fast = thuần SQLite query. Deep = vector + graph + optional LLM synthesis.

---

### Từ Honcho — Representation Layer (★★★)

**Pattern học được:**

```
Raw message → Deriver → Conclusion (structured)
Conclusions → Dreamer → Representation (static, cached artifact)

Representation: low-latency, pre-computed, ready to inject
Raw search: full cost, real-time
```

**Tại sao quan trọng:** Nếu agent cần context nhanh ở session start, không nên search real-time. Pre-computed representation là cache layer giữa memory raw và agent.

**Học gì:** Smart Memory nên có một `representation` layer — pre-computed compact summary của toàn bộ state quan trọng nhất của project. Update khi memory thay đổi, không phải khi agent cần.

---

### Từ RetainDB — Typed Memory Events (★★★★)

**Pattern học được:**

```typescript
type MemoryType =
  | "factual"       // fact khách quan
  | "preference"    // user/project preference
  | "event"         // điều đã xảy ra
  | "goal"          // mục tiêu cần đạt
  | "instruction"   // hướng dẫn phải tuân theo
  | "relationship"  // mối liên hệ giữa entities
  | "opinion"       // nhận định, đánh giá

agent.event({ type: "decision" | "constraint" | "outcome", content: "..." })
```

**Tại sao quan trọng:** Biết TYPE của memory giúp search và filter chính xác hơn. "Tìm tất cả decisions" khác với "tìm tất cả preferences". Token budget có thể phân bổ khác nhau theo type.

**Học gì:** Schema của Memory record PHẢI có `type` field. Không để agent tự diễn giải từ raw content. Một số types (preference, instruction) nên luôn được include trong wake_up, bất kể age.

---

### Từ RetainDB — Handoff Pattern (★★★)

**Pattern học được:**

```typescript
// Agent A kết thúc công việc:
const shareId = await db.agent(agentId).handoff()

// Agent B tiếp nối:
const context = await db.agent(agentId).receive(shareId)
// context chứa: summary of work done, open tasks, key decisions, next steps
```

**Tại sao quan trọng:** Khi một task kéo dài qua nhiều session hoặc nhiều agent, context handoff là critical. Không có handoff → mỗi session start lại từ đầu.

**Học gì:** Smart Memory nên có `handoff` / `session_summary` operation được trigger ở SessionEnd. Output là structured JSON: `{ summary, open_loops, decisions_made, next_steps }`.

---

### Từ Hindsight — 4-Strategy Search (★★★)

**Pattern học được:**

```python
# Chạy song song, merge bằng RRF:
results = parallel([
    semantic_search(query),      # embedding similarity
    bm25_search(query),          # keyword
    graph_search(entities),      # entity link traversal
    temporal_search(date_range)  # time-aware
])
fused = reciprocal_rank_fusion(results)
reranked = cross_encoder.rerank(query, fused)
```

**Học gì:** Temporal search có giá trị cao cho agent memory — "quyết định gần đây nhất về X" là query phổ biến. Smart Memory nên có thể filter/boost theo recency mà không cần full text search.

**Vứt gì:** Cross-encoder reranking thêm LLM dependency vào read path — vi phạm tiêu chí "nhanh". Chỉ dùng cho `recall_deep`, không phải `recall_fast`.

---

### Từ Hindsight — Bank Isolation (★★★★)

**Pattern học được:**

```
Mỗi "bank" là một isolated memory store.
Không có cross-bank query trừ khi explicitly permitted.
Một entity có thể tồn tại trong nhiều bank với perspective khác nhau.
```

**Tại sao quan trọng:** Đây là implementation của global/local boundary. "Bank" = project scope. Cross-bank query có kiểm soát = merge operation.

**Học gì:** Mỗi project phải là isolated "bank" với UUID riêng. Global knowledge là một bank đặc biệt mà mọi project đều có thể read (nhưng không write trực tiếp). Merge là explicit operation, không phải implicit cross-query.

---

### Từ OpenViking — Big Picture First, Lazy Zoom-In (★★★★)

**Pattern học được:**

```
L0: abstract     → 1-2 câu tóm tắt module/domain (luôn load)
L1: overview     → danh sách entities và relations chính (~500 tokens)
L2: details      → full content của node cụ thể (load khi cần)

Retrieval strategy: "lock L0 của tất cả → score → drill-down L1/L2 của top matches"
Không scan toàn bộ L2 trước khi biết cái gì relevant.
```

**Tại sao quan trọng:** Đây là implementation của Smart Macro-Graph. Agent thấy cấu trúc vĩ mô trước (không bị overwhelm), rồi mới đi vào chi tiết khi cần.

**Học gì:** Smart Memory's graph layer phải có multi-resolution. Mặc định trả L0 (tổng quan). Agent hỏi "explain more about X" → trả L1. Agent hỏi "show me the exact implementation decision" → trả L2.

---

### Từ Superpowers — Structured Workflow Injection (★★★)

**Pattern học được:**

```
SessionStart hook inject một "meta-skill":
- Dạy agent biết KÍCH HOẠT KHI NÀO từng skill
- Quy tắc 1%: nếu có 1% khả năng một skill liên quan → phải invoke
- Skill composability: skill A có thể gọi skill B

Brainstorm → Spec → Plan → TDD là default workflow bắt buộc.
```

**Học gì:** Smart Memory nên có một "bootstrap prompt" inject ở SessionStart để dạy agent cách dùng memory tools đúng cách — khi nào recall, khi nào store, khi nào wake_up. Đây là thay thế cho manual hook của ICM.

---

### Từ Superpowers — SKILL.md Format (★★)

**Pattern học được:**

```markdown
# Skill: recall-before-code
## Trigger: before writing any code for a feature
## Steps:
  1. Call memory_recall("feature decisions {feature_name}")
  2. If results: review constraints before proceeding
  3. If empty: proceed but store decision after
```

**Học gì:** Smart Memory nên có một tập "behavior definitions" dạng SKILL.md để inject vào agent. Không phải hardcode trong CLAUDE.md mà là dynamic — load theo project context.

---

### Từ Understand-Anything — Graph Data Model cho Smart Macro-Graph (★★★★★)

**Pattern học được:**

```
4 nhóm node tách bạch:
  Code nodes:     file, function, class, module, concept
  Non-code:       config, document, service, endpoint, pipeline
  Domain nodes:   domain → flow → step  ← business logic hierarchy
  Knowledge:      article, entity, topic, claim

35 edge types, 8 nhóm:
  Structural (imports, contains, inherits), Behavioral (calls, publishes),
  Data flow (reads_from, writes_to), Semantic (related, similar_to), ...

Node ID: "<prefix>:<path>:<name>"   → ví dụ "function:src/auth.ts:login"
Edge: source, target, type, weight(0-1), direction(forward/backward/bidirectional)
```

**Tại sao quan trọng:** Đây là reference tốt nhất cho Smart Macro-Graph. `domain → flow → step` hierarchy là cách model business logic mà không trộn với code structure. 21 node types đủ expressiveness nhưng không over-engineer.

**Học gì:** Smart Memory's Concept layer nên dùng node hierarchy tương tự: Module/Domain → Entity/Flow → Decision/Constraint. Tách domain node khỏi code node. Edge types phải typed (không chỉ là generic `related`).

---

### Từ Understand-Anything — Fingerprinting cho Incremental Update (★★★★★)

**Pattern học được:**

```python
FileFingerprint:
  contentHash: SHA-256           # exact match → SKIP hoàn toàn
  functions: [name, params, exported, lineCount]
  classes: [name, methods]
  imports: [source, specifiers]

Change classification:
  hash đồng nhất         → NONE (0 LLM calls)
  hash khác, sigs đồng   → COSMETIC (0 LLM calls)
  sigs khác              → STRUCTURAL (re-analyze)

Update scope (số files structural):
  0        → SKIP
  1-10     → PARTIAL_UPDATE
  11-30    → ARCHITECTURE_UPDATE
  30+      → FULL_UPDATE
```

**Tại sao quan trọng:** Khi Smart Memory "learns" project structure, không muốn re-scan toàn bộ mỗi lần. Fingerprinting cho phép chỉ re-index phần thực sự thay đổi.

**Học gì:** `smem learn` (hoặc tương đương) phải có fingerprint layer. SHA-256 của file content → nếu hash đồng → skip. Chỉ tốn LLM call khi structure thực sự thay đổi.

---

### Từ Understand-Anything — 4-Tier Schema Validation (★★★★)

**Pattern học được:**

```
Tier 1 (Sanitize):  null → undefined cho optional fields
Tier 2 (Normalize): alias resolution
                    "func" | "method" → "function"
                    "struct" | "interface" → "class"
                    "forward" (default), "backward", "bidirectional"
Tier 3 (Auto-fix):  default missing fields nếu có thể suy ra
Tier 4 (Referential integrity):
                    drop nodes không có ID
                    drop edges không có source/target hợp lệ
                    report issues nhưng không crash
```

**Tại sao quan trọng:** LLM output không bao giờ perfectly conform với schema. Nếu không có pipeline này, graph bị corrupt theo thời gian.

**Học gì:** Mọi `icm_memory_store` hoặc tương đương phải qua validation pipeline trước khi persist. Đặc biệt alias resolution — agent hay viết sai type names.

---

### Từ Understand-Anything — Committable Artifact (★★★)

**Pattern học được:**

```
graph lưu tại: .understand-anything/knowledge-graph.json
commit vào git → teammates clone về dùng ngay
git diff graph.json → thấy architectural changes qua thời gian
```

**Học gì:** Smart Memory project config (`.smart-memory.config.json`) nên commit vào git để team share `project_id`. Representation cache cũng có thể commit để đồng đội không phải rebuild.

---

### Từ Mem0 — Provider Registry Pattern (★★)

**Pattern học được:**

```python
# Abstract base class → concrete implementations
class VectorStore(ABC):
    def add(self, vectors, metadata): ...
    def search(self, query_vector, limit): ...

# Registry với fallback chain
store = VectorStore.create(config.vector_store_type)
```

**Học gì:** Smart Memory's storage layer nên có abstract interface — dù bên dưới là SQLite, pgvector, hay Turso. Cho phép swap backend mà không thay đổi tool API.

**Vứt gì:** 30+ implementations → technical debt không cần thiết. Chỉ cần 2-3 backends được support tốt: SQLite (local-first), PostgreSQL (team), Turso (cloud-sync).

---

### Từ Hermes — Plugin Orchestration Layer (★★)

**Pattern học được:**

```
Built-in memory (prompt-injected, bounded) + External providers (pluggable, unbounded)
Prefetch thread + sync thread tách riêng
Agent không cần biết provider bên dưới là gì
```

**Học gì:** Smart Memory server layer nên có một "provider" concept để có thể kết nối vào external memory systems. Nhưng canonical store vẫn phải là internal JSON/SQLite — external providers là supplement, không phải replacement.

---

## Tổng Hợp: Bộ Ý Tưởng Thiết Kế Smart Memory

Dưới đây là bộ patterns được chọn lọc, có thứ tự ưu tiên, để build Smart Memory:

### Tier 1 — Bắt buộc (không có là sai design)

| Pattern | Học từ | Lý do bắt buộc |
|---|---|---|
| **Progressive Disclosure (3 layer)** | claude-mem | Tiêu chí "hiệu quả": giảm 90% token waste |
| **Lifecycle Hooks tự động** | claude-mem | Tiêu chí "không nhắc lại": agent không tự nhớ |
| **UUID project_id trong local config** | PURPOSE.md | Tiêu chí "ổn định": chống path drift |
| **wake_up / context_pack** | ICM | Tiêu chí "nhanh": sub-10ms session hydration |
| **Memory Versioning (supersedes[])** | agentmemory | Không mất history khi consolidate |
| **Typed Memory (type field)** | RetainDB | Filter chính xác, không interpret từ content |
| **Global/Local Bank Isolation** | Hindsight | Tiêu chí "layer rõ": project boundary thực sự |
| **4-Tier Schema Validation** | Understand-Anything | LLM output không bao giờ perfectly valid — phải sanitize → normalize → auto-fix → referential integrity |

### Tier 2 — Quan trọng (không có thì yếu)

| Pattern | Học từ | Lý do quan trọng |
|---|---|---|
| **Hybrid Search: BM25 + Vector + Graph** | agentmemory | Coverage tốt nhất, không miss case nào |
| **RRF merge** | agentmemory, Hindsight | Không cần normalize score, đơn giản và hiệu quả |
| **Graph 1-hop expansion** | ICM | Related memories nổi lên tự nhiên |
| **Dual layer: Memory vs Concept** | ICM | Decay vs permanent cho loại knowledge khác nhau |
| **recall_fast vs recall_deep** | Honcho | Cost/quality tradeoff explicit |
| **Handoff / session_summary** | RetainDB | Context continuity across sessions |
| **Reinforcement decay formula** | agentmemory | Memory tự học từ access pattern |
| **Auto-dedup similarity check** | ICM | Tránh duplicate trước khi store |

### Tier 3 — Nâng cao (có thì tốt hơn)

| Pattern | Học từ | Ghi chú |
|---|---|---|
| **Multi-resolution graph (L0/L1/L2)** | OpenViking | Big Picture First → Lazy Zoom-In |
| **Domain node hierarchy (domain→flow→step)** | Understand-Anything | Business logic tách khỏi code structure trong Smart Macro-Graph |
| **Fingerprinting cho incremental learn** | Understand-Anything | Chỉ re-index phần thay đổi khi `smem learn` chạy lại |
| **Alias resolution table** | Understand-Anything | Normalize LLM type output về canonical form trước khi persist |
| **Representation cache layer** | Honcho | Pre-computed compact summary, update khi memory đổi |
| **Temporal search boost** | Hindsight | "Quyết định gần đây nhất về X" query |
| **Disposition traits** | Hindsight | Reflect khác nhau theo context của project |
| **SKILL.md bootstrap prompt** | Superpowers | Dynamic behavior definition, thay vì hardcode |
| **Feedback correction loop** | ICM | Học từ AI prediction sai |
| **Merge wizard** | PURPOSE.md | Nâng local pattern lên global có chủ đích |

### Tier 4 — Không làm (anti-pattern)

| Anti-pattern | Nguồn | Lý do tránh |
|---|---|---|
| **Manual hook calls** | ICM | Không đảm bảo tiêu chí "không nhắc lại" |
| **Raw markdown dump cho agent đọc** | nhiều tools cũ | Vi phạm principle của PURPOSE.md |
| **30+ backend integrations** | Mem0 | Technical debt không cần thiết |
| **Cross-encoder reranking on fast path** | Hindsight | LLM call trên read path → phá tiêu chí "nhanh" |
| **Git Root làm project identifier** | claude-mem | Fragile, rename/move → mất memory |
| **Micro-node graph (file/function level)** | ICM icm_learn | Hairball Problem |
| **Single kho không boundary** | Mem0, ICM | Tiêu chí "layer rõ" không thỏa mãn |
| **Overwrite thẳng khi consolidate** | ICM | Mất history, không rollback được |

---

## Kiến Trúc Tối Thiểu Khả Thi

Dựa trên extraction trên, Smart Memory cần ít nhất:

```
┌─────────────────────────────────────────────────────┐
│                   Agent Layer                       │
│   wake_up() → inject context → tools available     │
│   hooks: SessionStart / PostToolUse / SessionEnd    │
└────────────────────┬────────────────────────────────┘
                     │ MCP / HTTP
┌────────────────────▼────────────────────────────────┐
│                  Tool Layer                         │
│                                                     │
│  recall_fast(query, project_id, max_tokens)         │
│  recall_deep(query, project_id)                     │
│  store(type, content, importance, project_id)       │
│  wake_up(project_id, max_tokens)                    │
│  handoff(project_id)                                │
│  merge_wizard(source, target, criteria)             │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│               Canonical Store                       │
│                                                     │
│  Memory records (JSON + FTS5 + vector)              │
│  Concept records (permanent, graph)                 │
│  Project registry (uuid → name → path mapping)     │
│                                                     │
│  ~/.smart-memory/                                   │
│    global/                    ← global bank         │
│    projects/<uuid>/           ← per-project bank    │
│      memories.db              ← SQLite              │
│      vectors.idx              ← vector index        │
└─────────────────────────────────────────────────────┘

Local project:
  .smart-memory.config.json → { "project_id": "uuid-v4", "name": "..." }
```

**Invariants:**
- Agent chỉ thấy tool API, không bao giờ đọc DB trực tiếp
- `project_id` là UUID lưu trong config file — không derive từ path
- Global bank là read-only với project agents; chỉ explicit promote mới write lên global
- Mọi update = write mới + soft-delete cũ (không overwrite)
- `wake_up` không cần LLM call, chỉ cần SQLite + sorting + truncate
