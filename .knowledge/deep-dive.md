# Deep Dive — Nền Tảng Thiết Kế Smart Memory

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

## Hook Design — Nguyên Tắc Không Lạm Dụng

### Vấn đề của ICM (anti-pattern)

ICM yêu cầu agent thực hiện ceremony thủ công trước mọi hành động:
```
SessionStart → ToolSearch (load deferred tools)
             → icm_wake_up()          ← LLM turn #1
             → icm_memory_recall()    ← LLM turn #2
             → (mới được làm việc)
             → icm_memory_store()     ← sau mọi decision/error/preference/20 tool calls
```

**3 lỗi thiết kế:**
1. **Hooks là agent-side ceremony, không phải platform-side automation.** Agent phải nhớ gọi. Nếu quên → context mất. Nếu nhớ → 2-4 extra round trips trước khi làm việc.
2. **SessionStart blocking.** User hỏi một câu đơn giản → agent phải chạy ceremony xong mới trả lời.
3. **Trigger quá nhiều.** Mọi decision, preference, error resolved, >20 tool calls → phải store. Agent lo lắng "mình có nên store không?" thay vì làm việc.

---

### Thiết kế đúng: Platform-Side, Transparent, Async

**Nguyên tắc cốt lõi: Agent không biết hooks tồn tại.**

```
SessionStart hook (platform fires):
  platform đọc pre-computed wake_up cache (file, <10ms)
  inject trực tiếp vào system prompt như extra context
  → agent thấy context có sẵn, không gọi gì
  → 0 LLM calls, 0 agent round trips

PostToolUse hook (platform fires, async):
  platform nhìn tool + output
  nếu signal thấp → bỏ qua (return ngay)
  nếu signal cao → enqueue background job (return ngay)
  background job: extract + store + update wake_up cache
  → agent KHÔNG chờ, tiếp tục làm việc ngay

Stop hook (platform fires sau khi agent respond):
  user đã nhận response rồi → trigger background summarize
  → 0ms overhead cho user
```

### Signal Filter — Không Capture Mọi Thứ

```
Capture (signal cao):
  Tool = Edit/Write + file content dài          → likely có decision
  Tool = Bash + output > 500 chars + no error   → likely có kết quả có nghĩa
  Tool = Bash + output chứa error message       → potential "error resolved"
  User message chứa "quyết định", "chọn", "dùng X thay vì Y"

Bỏ qua (signal thấp):
  Tool = Read (thụ động, không tạo knowledge)
  Tool = Glob / Grep / LS (search thuần)
  Tool = Bash output rỗng hoặc < 50 chars
  Cùng tool call lặp lại trong 60 giây
  Tool = TodoRead, TodoWrite
```

### Wake_up Pre-computation — Không On-Demand

```
SAI (ICM style):
  SessionStart → agent gọi icm_wake_up → LLM turn → result → inject

ĐÚNG:
  Mỗi khi memory thay đổi (PostToolUse/Stop hook) →
    background job rebuild wake_up cache file
  SessionStart → platform đọc cache → inject vào system prompt
  → Sub-10ms, không LLM call, agent không thấy gì
```

### Blocking vs Non-blocking

```
Non-blocking (fire and forget):
  PostToolUse, Stop, SessionEnd → background queue
  Nếu queue fail → memory bị miss nhưng không crash session

Blocking chỉ khi bắt buộc:
  SessionStart inject → blocking nhưng từ cache (< 10ms, chấp nhận được)
  Permission check → blocking nhưng binary yes/no (< 50ms)
  
KHÔNG bao giờ blocking trên đường write thông thường.
```

### Background Job Làm Gì — Nguồn Dữ Liệu Thực Tế

Background job nhận 2 nguồn, không phải raw prompt:

**Nguồn 1 — Hook payload (structured, có ngay):**
```json
{
  "tool_name": "Edit",
  "tool_input": { "file": "src/auth.ts", "old_string": "user.id", "new_string": "user?.id" },
  "tool_response": "File edited successfully"
}
```

**Nguồn 2 — Transcript file (agent ghi ra disk):**
```
~/.claude/projects/<hash>/transcripts/<session>.jsonl
```
Daemon đọc N messages gần nhất để lấy ngữ cảnh xung quanh tool call.

**Process:**
```
hook payload + transcript context
    ↓
Signal check (không LLM): tool nào? output có nghĩa không?
    ↓ nếu signal cao
LLM extract (cheap model, nhỏ):
  "Given this edit/bash/write and conversation, what was decided/fixed/learned?"
    ↓
Store structured record (KHÔNG store raw):
  { type: "error_resolved", content: "...", keywords: [...] }
```

**Ví dụ extract:**

| Raw input vào LLM | Memory được store |
|---|---|
| Edit auth.ts: `user.id → user?.id` + "fix null check" | `{ type: "error_resolved", content: "Fix null pointer bug user?.id trong auth.ts" }` |
| Bash output: chạy test pass + "xong rồi" | `{ type: "event", content: "Tests passing sau khi refactor auth module" }` |
| User: "từ nay dùng conventional commits" | `{ type: "preference", content: "Conventional commits: feat/fix/chore/..." }` |

---

### Adapter per Agent — Nhận Biết Agent Đang Chạy

Mỗi agent có hook system, transcript format, config path riêng. Cần adapter layer:

```
Agent (Claude Code / Codex / Antigravity / Gemini CLI / ...)
  │  fires hook (format riêng)
  ▼
Adapter (claude-code / codex / antigravity / ...)
  │  translate → AgentEvent (normalized)
  ▼
Daemon (agent-agnostic, chỉ xử lý AgentEvent)
  │  extract + store
  ▼
SQLite + wake_up cache
```

**Normalized AgentEvent:**
```typescript
interface AgentEvent {
  agent: "claude-code" | "codex" | "antigravity" | "gemini-cli" | ...
  event_type: "tool_use" | "session_start" | "session_end"
  tool_name?: string
  tool_input?: any
  tool_output?: string
  session_id: string
  project_path: string
  timestamp: number
}
```

Daemon không quan tâm agent nào. Thêm agent mới = thêm adapter, không sửa daemon.

**Detect agent:**
```bash
smem install            # auto-detect: check env vars, process tree, config files
smem install --agent codex   # explicit
```

**Fallback cho agents không có hook:**
- Polling transcript file nếu agent ghi ra disk
- Wrapper script: `smem-wrap codex` intercept stdin/stdout
- Manual: `smem store "vừa quyết định dùng SQLite"`

---

### Kết Luận Hook Design

| Thuộc tính | Mục tiêu |
|---|---|
| Ai fire hooks | Platform/harness, KHÔNG phải agent |
| Agent awareness | Zero — agent không biết hooks tồn tại |
| SessionStart overhead | < 10ms (inject from cache) |
| PostToolUse overhead | 0ms (enqueue, async) |
| Trigger criteria | Signal filter — Edit/Write/Bash significant only |
| Wake_up | Pre-computed cache, rebuild khi memory đổi |
| Failure mode | Miss memory, không crash session |
| Multi-agent | Adapter per agent, daemon agent-agnostic |
| Stored data | Extracted facts, KHÔNG phải raw prompt |

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

### Từ Zep — Temporal Fact Model (★★★★★)

**Pattern học được:**

```python
# Mỗi fact không chỉ có timestamp mà có VALIDITY PERIOD:
EntityEdge {
    fact: "User prefers Adidas"
    valid_at: 2025-01-01        # khi fact bắt đầu đúng
    invalid_at: 2025-03-15      # khi fact hết hiệu lực
}
EntityEdge {
    fact: "User prefers Puma"
    valid_at: 2025-03-15
    invalid_at: None            # vẫn đang đúng
}

# Query temporal:
"decisions made in January 2025" → filter WHERE valid_at <= T AND (invalid_at IS NULL OR invalid_at > T)
"current preferences" → filter WHERE invalid_at IS NULL
```

**Tại sao quan trọng:** Timestamp đơn thuần chỉ nói "khi nào fact được ghi lại". Temporal validity nói "khi nào fact đúng". Đây là sự khác biệt quan trọng cho agent reasoning: "decision từ tháng 1 vẫn còn valid không?" — không trả lời được với timestamp.

**Học gì:** Smart Memory record phải có `valid_at` + `invalid_at`. Khi memory bị supersede (thay thế), không chỉ mark `superseded_by` mà set `invalid_at = now`. Cho phép time-travel query: "context tại thời điểm T".

---

### Từ Zep — Context Templates (★★★★)

**Pattern học được:**

```python
# Định nghĩa template một lần, dùng lại nhiều lần:
template = """
%{critical_decisions limit=3}
%{recent_preferences limit=5 types=[PREFERS,HAS_REQUIREMENT]}
%{open_tasks limit=2}
"""
client.create_template(template_id="project-context-v1", template=template)

# Agent chỉ gọi:
context = get_context(project_id, template_id="project-context-v1")
# Nhận pre-formatted string, không cần biết internals
```

**Tại sao quan trọng:** Tách "cách lấy context" khỏi "cách format context". Application code không phụ thuộc vào retrieval logic. Template có thể thay đổi mà không sửa agent code.

**Học gì:** Smart Memory nên có template system per-project. User định nghĩa "profile" của context mà agent sẽ nhận, thay vì hardcode trong CLAUDE.md.

---

### Từ Zep — Contextualized Document Chunking (★★★)

**Pattern học được:**

```python
# Không chunk raw, mà inject document-level context:
for chunk in split(document, size=500, overlap=50):
    context = llm.generate(
        f"Situate this chunk within the full document: {full_doc_summary}\n\nChunk: {chunk}"
    )
    store(f"[Context: {context}]\n\n{chunk}")
```

**Học gì:** Khi Smart Memory ingest spec/document, contextualize mỗi chunk trước khi store. Cải thiện retrieval accuracy đáng kể vì chunk không còn bị "tách rời" khỏi ngữ cảnh của document.

---

### Từ A-mem — Bidirectional Evolution (★★★★)

**Pattern học được:**

```python
process_memory(new_note):
    neighbors = find_similar(new_note, k=5)
    
    llm_response = llm.decide({
        new_note: new_note,
        neighbors: neighbors,
        question: "Should I update neighbors based on this new info?"
    })
    
    if "update_neighbor" in llm_response.actions:
        for neighbor, new_context in zip(neighbors, llm_response.new_contexts):
            neighbor.context = new_context  # neighbors được update ngược
            neighbor.tags = new_tags[i]
```

**Tại sao quan trọng:** Mọi hệ khác (agentmemory, Mem0, ICM) chỉ update forward — memory mới link đến cũ. A-mem là duy nhất update backward — memory mới có thể enrichment/correct memories cũ. Phù hợp với tiêu chí "không nhắc lại": khi biết thêm thông tin, memories cũ được tự động cập nhật.

**Học gì:** Khi store memory, bên cạnh dedup check, thêm "influence check": LLM xem xét liệu memory mới có làm thay đổi ý nghĩa của memories liên quan không. Nếu có → trigger enrichment job (async, không block store). Không làm sync như A-mem vì quá expensive.

---

### Từ A-mem — Semantic Triple: Keywords + Context + Tags (★★★)

**Pattern học được:**

```python
MemoryNote {
    content: str           # raw content
    keywords: List[str]    # semantic concepts (extracted by LLM)
    context: str           # one-sentence domain/theme summary
    tags: List[str]        # classification labels
}
```

**Học gì:** Smart Memory schema phải enforce 3 fields này. Không để agent tự quyết có điền không. `keywords` → BM25 search. `context` → domain clustering và wake_up filtering. `tags` → type-based recall ("show me all decisions").

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

### Từ MemOS — Async-First Store với MemScheduler (★★★★★)

**Pattern học được:**
```python
chat(query):
    response = llm.generate(query)   # return ngay
    submit_async_task(query, chat_id)  # background
    # Redis Streams queue → background worker:
    # extract memories → conflict detection → graph reorg → skill promotion
    return response
```

**Tại sao quan trọng:** Tiêu chí "nhanh" — store không được block response. User không đợi embedding + graph update. Mọi enrichment xảy ra background, session sau hưởng lợi.

**Học gì:** Smart Memory `store()` phải return immediately với ID. Background job xử lý: embedding, auto-link, dedup check, consolidation. Dùng queue (Redis/SQLite WAL) thay vì blocking I/O.

---

### Từ MemOS — Size-Bounded Tiers với Auto-Compaction (★★★★)

**Pattern học được:**
```python
memory_size = {
    "WorkingMemory": 20,      # rapid buffer
    "LongTermMemory": 1500,   # main store
    "UserMemory": 480,        # compressed prefs
}
threshold = 0.80  # trigger compaction

# khi WorkingMemory > 20*0.8=16:
# → move high-value items to LongTermMemory
# → consolidate duplicates
# → trigger GraphStructureReorganizer
```

**Học gì:** Không để memory accumulate vô hạn mà không có compaction policy. Mỗi tier có size limit + auto-promote/demote. Working buffer nhỏ (20) → filter noise sớm trước khi vào LongTerm.

---

### Từ MemOS — Iterative Retrieval với LLM Judge (★★★)

**Pattern học được:**
```python
search(query):
    results = hybrid_search(query)
    while not llm.can_answer(query, results):
        phrases = llm.generate_retrieval_phrases(query, results)
        results += hybrid_search(phrases)  # expand
    return synthesize(results)
```

**Học gì:** Cho `recall_deep` mode: nếu top results không đủ → LLM generate thêm retrieval phrases → search lại. Multi-hop information gathering mà không cần hardcode graph traversal depth.

---

### Từ MemOS — Source-Aware Provenance (★★★★)

**Pattern học được:**
```python
SourceMessage {
    type: "chat"|"doc"|"web"|"file"|"system"
    role: "user"|"assistant"|"system"
    content: str  # minimal reproducible snippet (không full conversation)
}
# visibility: "private"|"public"|"session"
```

**Học gì:** Provenance không cần store toàn bộ conversation, chỉ cần reproducible snippet. `visibility` field cho phép fine-grained access: session memories không lộ ra ngoài session.

---

### Từ cognee — UUID5 Deterministic Deduplication (★★★★★)

**Pattern học được:**
```python
class Memory(DataPoint):
    metadata = {"identity_fields": ["topic", "source_session"]}
    # UUID5(topic + source_session) → same entity = same ID
    # auto-dedup ở DB layer, không cần similarity check
```

**Tại sao quan trọng:** Similarity threshold (0.85) có thể false positive (merge distinct memories) hoặc false negative (duplicate với 0.84). UUID5 từ semantic identity fields cho deterministic dedup khi identity rõ.

**Học gì:** Một số memory types có identity rõ (preference, instruction) → dùng UUID5. Types khác không có identity → dùng similarity check. Không áp dụng một approach cho tất cả.

---

### Từ cognee — Auto-Routing Search Strategy (★★★★)

**Pattern học được:**
```python
# 15+ strategies, agent không cần chọn:
SearchType:
    TRIPLET_COMPLETION     # Subject-Predicate-Object decomposition
    GRAPH_COMPLETION       # graph traversal + LLM (DEFAULT)
    GRAPH_COMPLETION_COT   # chain-of-thought
    TEMPORAL               # time-aware
    CHUNKS_LEXICAL         # keyword FTS
    FEELING_LUCKY          # auto-route best

# query_router.py: rule-based classifier
# "What did I decide last month?" → TEMPORAL
# "How does auth work?" → GRAPH_COMPLETION_COT
# "Find exact phrase X" → CHUNKS_LEXICAL
```

**Học gì:** Agent không nên biết phải dùng search strategy nào. Smart Memory nên có `recall_router` — phân tích query intent → route về strategy phù hợp. Minimal API: `recall(query)`.

---

### Từ cognee — Typed Memory Entries (★★★★)

**Pattern học được:**
```python
TraceEntry {
    origin_function: str     # "handle_button_click"
    status: "success"|"error"
    method_params: dict
    memory_query: str        # "button interactions"
    memory_context: str      # "onboarding flow"
}
SkillRunEntry {
    selected_skill_id: str
    success_score: float     # 0-1
    result_summary: str
}
```

**Học gì:** Bên cạnh `factual`, `preference`, `decision`, cần typed entries cho agent interactions: tool execution trace, skill run outcome. Cho phép query: "tất cả tool calls fail gần đây?" hoặc "skill nào có success_score thấp nhất?"

---

### Từ ByteRover — Sidecar Signals (★★★★★)

**Pattern học được:**
```
Runtime signals lưu RIÊNG khỏi content:
  - accessCount, importance (0-100), maturity, recency, updateCount

Tại sao riêng?
  - Signals thay đổi mỗi query → pollute git history nếu embedded
  - No merge conflicts trong team
  - Per-machine ranking khác nhau
```

**Học gì:** Smart Memory nên có `memory_signals` table riêng, không embed trong `memories` table. Weight, access_count, recency_score → separate store, update without touching content record.

---

### Từ ByteRover — Lane Budgeting (★★★★★)

**Pattern học được:**
```typescript
// Allocate token budget theo lanes, không top-N flat:
lanes = {
    summaries: 2000,   // hierarchical summaries (d1-d3)
    contexts: 4000,    // raw context files (d0)
    stubs: 500         // archive ghost cues
}
// Fill each lane highest-score-first đến budget
```

**Học gì:** `wake_up` nên có lane system thay vì flat top-N: `decisions: 1000 tokens`, `preferences: 500 tokens`, `recent_facts: 500 tokens`. Mỗi lane có budget riêng → không một category nào chiếm hết token budget.

---

### Từ ByteRover — Staleness Detection via Content Hash (★★★★)

**Pattern học được:**
```typescript
SummaryFrontmatter {
    children_hash: string  // SHA-256 of children content
    // khi children thay đổi → hash mismatch → regenerate summary
}
```

**Học gì:** Mọi derived artifact (representation cache, wake_up pack, summary) phải có `children_hash`. Chỉ regenerate khi hash mismatch. Không regenerate theo timer — regenerate theo data change.

---

### Từ ByteRover — 4-Tier Query với Pre-fetch (★★★★)

**Pattern học được:**
```
Tier 0 (0ms):    exact cache hit
Tier 1 (~50ms):  fuzzy cache (Jaccard)
Tier 2 (~200ms): BM25 search, no LLM
Tier 3 (~5s):    pre-fetch top 5 → inject vào optimized LLM prompt
Tier 4 (8-15s):  full agentic loop

Smart routing: nếu Tier 2 score >= 0.7 → pre-fetch → Tier 3
                                         → giảm Tier 4 từ 30% → 5%
```

**Học gì:** `recall_fast` = Tier 0-2 (pure cache + BM25, 0 LLM calls). `recall_deep` = Tier 3-4. Pre-fetch trick: chạy search trước, inject results vào LLM prompt thay vì để LLM tự search từ đầu.

---

### Từ Letta-code — Agent Self-Edits Its Own Context (★★★★★)

**Pattern học được:**
```
Memory blocks = editable segments của system prompt.
Agent tự rewrite → behavior thay đổi ngay invocation tiếp theo.
Git-tracked → reversible, auditable, collaborative.
```

**Tại sao quan trọng:** Đây là cách thực hiện "không nhắc lại" triệt để nhất. Agent không chỉ "nhớ" facts — agent **tự modify hành vi** của mình. Không cần fine-tune, không cần training loop.

**Học gì:** Smart Memory nên có "writable context blocks" layer — một số sections của system prompt có thể bị agent update (ví dụ: `[preferences]`, `[project_conventions]`, `[current_focus]`). Version-controlled.

---

### Từ Letta-code — Layered Skill Priority Stack (★★★★)

**Pattern học được:**
```
Project skills  (.skills/)           ← override all
Agent skills    (~/.letta/.../skills/)
Global skills   (~/.letta/skills/)
Bundled skills  (package defaults)   ← lowest
```

**Học gì:** Smart Memory behavior definitions (SKILL.md / context templates) phải có cùng hierarchy. Project-level definitions override agent-level. Team shares global defaults, individual projects customize.

---

### Từ Letta-code — Dual-Mode Backend với Capability Flags (★★★★)

**Pattern học được:**
```typescript
BackendCapabilities {
    remoteMemfs: bool      // sync to remote
    localMemfs: bool       // local git
    serverSecrets: bool    // secrets API
}
// Same interface → flag quyết định features available
// Local mode: không cần login, privacy-first
// API mode: full features, team sync
```

**Học gì:** Smart Memory server phải có local-first mode và optional cloud mode. `SmartMemoryCapabilities` flags: `cloud_sync`, `team_share`, `cross_project_search`. Local mode là default, cloud là opt-in.

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

### Từ TencentDB — Offline Vector Search: sqlite-vec + Local GGUF (★★★★★)

**Pattern học được:**

```
Embedding pipeline có fallback chain:
  1. Try local GGUF model (embeddinggemma-300m, 300MB, node-llama-cpp)
  2. If model not ready → fallback to FTS5 keyword-only
  3. Never block on embedding failure

Storage: SQLite + sqlite-vec extension
  → vector similarity search thuần SQL, không cần external vector DB
  → offline hoàn toàn, không cần API call

Warmup async: model load background, không block first request
  → first conversation có thể chậm hơn nếu model đang download
```

**Tại sao quan trọng:** Đây là missing piece trong smem design. Vector search offline-capable là yêu cầu nhưng chưa có implementation plan. TencentDB đã proven pattern này: sqlite-vec + local GGUF.

**Học gì:** smem cần chọn embedding model local (fastembed ONNX hoặc GGUF nhỏ ~100-300MB). sqlite-vec là extension tốt nhất cho SQLite vector search. Fallback về FTS5 nếu embedding unavailable — không crash, không báo lỗi, chỉ giảm recall.

---

### Từ ReMe — `when_to_use` field (★★★★)

**Pattern học được:**

```python
MemoryNode:
  content: str       # nội dung memory
  keywords: list     # cho BM25 search
  when_to_use: str   # "dùng khi agent cần hiểu auth flow"
```

`when_to_use` khác với `keywords`:
- `keywords` → BM25 lexical match ("postgresql", "database")
- `when_to_use` → semantic usage context ("dùng khi quyết định storage layer")

**Tại sao quan trọng:** Agent không chỉ cần tìm memory theo keyword — cần biết memory nào phù hợp với *tình huống hiện tại*. `when_to_use` là pre-computed hint giúp agent quyết định dùng memory nào mà không cần full recall.

**Học gì:** Thêm `when_to_use` vào YAML schema của smem. Optional field, agent điền khi store. smem dùng field này trong context()/focus() để rank memory theo relevance với current task.

---

### Từ memweave — Temporal Decay Formula + Graceful Degradation (★★★★)

**Pattern học được:**

```python
# Temporal decay — đã validate trên LongMemEval-S
lambda_ = math.log(2) / half_life_days
decay = math.exp(-lambda_ * age_days)

# half_life_days theo type:
decision    → infinity  (không decay)
preference  → infinity  (không decay)
event       → 21 ngày   (bán phân rã sau 3 tuần)
fact        → 60 ngày
error_resolved → 30 ngày

# Graceful degradation
try:
    vector_results = embed_and_search(query)
except EmbeddingError:
    vector_results = []  # không crash
    # FTS5 results vẫn được trả về
final = bm25_results + vector_results  # merge, dedupe

# Embedding cache
cache[sha256(content)] = vector  # tránh re-embed cùng content
```

**Tại sao quan trọng:** Formula đơn giản, đã được validate benchmark (97.24% recall). Không cần tự tính. Graceful degradation là must-have cho offline-capable system.

**Học gì:** Dùng formula này cho `decay_rate` thay vì tự design. Implement embedding cache từ đầu — cheap optimization lớn. Fallback BM25-only khi embedding fail — không báo lỗi với user.

---

### Self-Describing Orientation Tool — `smem orient` (★★★★★)

**Vấn đề không ai giải quyết:**

Tất cả các hệ hiện tại đều **query-first** — agent phải biết cần hỏi gì trước khi hỏi. Nhưng đầu session, agent không biết memory có gì, nên không biết hỏi cái gì. Đây là lỗ hổng cơ bản dẫn đến agent bỏ qua memory hoặc dùng sai.

`wake_up` giải quyết một phần — inject facts tự động — nhưng agent vẫn không biết:
- Memory này đang cover bao nhiêu topic?
- Cái gì là trọng tâm nhất của project?
- Còn memory nào chưa được inject nhưng đang tồn tại?
- Nên gọi tool nào tiếp theo, và khi nào?

**Pattern thiết kế:**

Agent gọi một tool duy nhất và nhận về toàn bộ orientation cần thiết. Tool **tự mô tả chính nó** — guide được sinh từ trạng thái thực của project, không phải văn bản cứng trong docs:

```typescript
smem.context(project_id) → {
  spine: [
    { slug: "architecture-overview", summary: "Hybrid storage, global+local bank", count: 12, freshness: "2d" },
    { slug: "auth-decisions",        summary: "JWT, refresh token strategy",        count: 5,  freshness: "5d" },
    { slug: "db-layer",              summary: "SQLite local-first, WAL mode",        count: 8,  freshness: "1d" },
    { slug: "open-loops",            summary: "Merge wizard, web UI chưa làm",       count: 2,  freshness: "3d" }
  ],
  last_session: {
    summary: "Implement db migration layer, chốt SQLite WAL mode",
    open_loops: ["Merge wizard chưa implement", "Web UI pending"]
  },
  usage_guide: {
    tools: [
      { name: "orient",     when: "đầu session hoặc khi cần hiểu full picture" },
      { name: "focus",      when: "drill vào một topic cụ thể từ spine", example: "focus('db-layer')" },
      { name: "recall",     when: "tìm kiếm thông tin cụ thể bằng query", example: "recall('WAL mode decision')" },
      { name: "store",      when: "sau khi ra quyết định, fix lỗi, hoàn thành task có nghĩa" },
      { name: "open_loops", when: "kiểm tra task còn dở đầu hoặc cuối session" }
    ]
  }
}
```

**Tại sao quan trọng:**

1. **Navigation-first thay vì query-first.** Agent thấy bản đồ topic trước, rồi mới drill vào. Thay vì đoán keyword, agent biết chính xác `focus('db-layer')` sẽ trả về gì.

2. **Trust mechanism.** Agent thấy memory có substance (12 memories về architecture, 8 về db-layer) → tin tưởng dùng memory thay vì tự suy diễn. Đây là lý do agent bỏ qua memory: không thấy memory có giá trị.

3. **Usage guide gắn với trạng thái thực.** Không phải docs tĩnh trong CLAUDE.md — guide phản ánh đúng tools đang available và cách dùng theo context hiện tại.

4. **Không blocking, không LLM call.** Spine được pre-computed background, `context` chỉ đọc cache + format. Sub-20ms.

**Cơ chế sinh Spine:**

```
Trigger: PostToolUse (signal cao) hoặc SessionEnd

Background job:
  1. Cluster tất cả memories theo semantic similarity
  2. LLM (cheap model) sinh slug + 1-line summary cho mỗi cluster
  3. Detect open loops: memories type=goal/task chưa có resolution
  4. Detect topic relationships (cross-references giữa clusters)
  5. Lưu spine.json với children_hash
  
  Chỉ rebuild khi children_hash thay đổi — không rebuild theo timer.
```

**Spine không do user viết tay.** Nếu user muốn pin một topic thủ công:
```bash
smem pin "architecture-overview" --summary "Hybrid storage model, quyết định lõi"
```
Pinned topics luôn xuất hiện trong spine dù memory count thấp.

**Phân biệt `context` và `wake_up`:**

```
wake_up  (platform fires, agent không biết):
  → inject compact facts vào system prompt
  → agent thấy context nhưng không biết nó đến từ đâu
  → 0 LLM calls, <10ms từ pre-computed cache

orient   (agent chủ động gọi):
  → agent nhận structured response: spine + last_session + usage_guide
  → agent biết đang interact với memory system
  → 0 LLM calls, <20ms từ pre-computed spine cache
  → dùng khi wake_up không đủ hoặc agent cần full picture
```

Hai cơ chế không thay thế nhau — chúng bổ sung nhau:
- `wake_up` = passive hydration (always on)
- `context` = active navigation (on demand)

**Học gì:** Smart Memory phải có `context` như first-class tool trong API surface. Đây không phải nice-to-have — đây là cơ chế để agent **biết cách dùng và tin dùng** memory. Thiếu `context`, agent sẽ bỏ qua memory sau 2-3 session không thấy giá trị.

---

### Spine — Flat Map với Hard Cap (★★★★★)

**Vấn đề granularity:**

Spine phẳng có hai failure mode đối lập:
- Quá thô (3-4 topics) → agent không biết drill vào đâu
- Quá chi tiết (30+ topics) → hairball, agent bị overwhelm

**Giải pháp: flat spine + hard cap, không tier trung gian**

Thêm tier trung gian (L1 mapping) để giải quyết granularity là sai hướng — nó thêm complexity mà không thêm capability. Kết quả tương đương đạt được đơn giản hơn:

```
context()               → spine (5–8 topics) + last_session + usage_guide
focus('architecture')  → memories trong topic (trực tiếp, BM25+vector)
recall(query)          → cross-topic search
```

`focus(slug)` không trả về một tier mới — nó trả thẳng memories trong topic đó. Nếu agent cần narrow hơn, gọi `recall(query)` với context đã có từ `focus`.

**Granularity rule:**

```
Hard cap: 8 topics max
  >8 clusters → merge nhỏ nhất (không expand)
  topic >40 memories → split thành 2 topics riêng

Topic tốt:  architecture, auth-system, data-layer, open-loops
Topic xấu:  misc, decisions, other  ← không navigable
```

**Rebuild trigger (data-driven, không timer):**

```
Trigger rebuild spine khi:
  - Memory count tăng >20% so với lần build trước
  - Memory mới không fit topic nào (semantic distance > threshold)
  - Topic không có memory mới >60 ngày

Dùng children_hash để skip rebuild khi data chưa thực sự thay đổi.
Không rebuild mỗi store() — tốn và tạo noise.
```

**Tại sao hard cap quan trọng hơn algorithm:**

Clustering algorithm tốt nhất vẫn ra 15+ clusters nếu project đủ lớn. Hard cap buộc system phải merge = buộc tổng quát hóa = tránh hairball. Đây là nguyên tắc thiết kế, không phải optimization detail.

**Học gì:** Spine → Memory trực tiếp, không tier trung gian. Hard cap tại 8 topics. Rebuild theo data change, không theo timer.

---

## Tổng Hợp: Bộ Ý Tưởng Thiết Kế Smart Memory

Dưới đây là bộ patterns được chọn lọc, có thứ tự ưu tiên, để build Smart Memory:

### Tier 1 — Bắt buộc (không có là sai design)

| Pattern | Học từ | Lý do bắt buộc |
|---|---|---|
| **Progressive Disclosure (3 layer)** | claude-mem | Tiêu chí "hiệu quả": giảm 90% token waste |
| **Lifecycle Hooks tự động** | claude-mem | Tiêu chí "không nhắc lại": agent không tự nhớ |
| **UUID project_id trong local config** | PURPOSE.md | Tiêu chí "ổn định": chống path drift |
| ~~**wake_up / context_pack**~~ | ~~ICM~~ | ~~Bị loại — xem [decision](.decisions/no-wakeup-injection.md)~~ |
| **smem.guide() — cross-agent bootstrap** | — | Agent mới (bất kỳ loại nào) gọi 1 tool → self-onboard; `smem install` inject 1 dòng vào config file của agent để trigger |
| **smem.context() — project context on demand** | — | Agent tự pull khi user cần orient, không inject tự động; tách biệt với guide() |
| **Memory Versioning (supersedes[])** | agentmemory | Không mất history khi consolidate |
| **Typed Memory (type field)** | RetainDB | Filter chính xác, không interpret từ content |
| **Global/Local Bank Isolation** | Hindsight | Tiêu chí "layer rõ": project boundary thực sự |
| **4-Tier Schema Validation** | Understand-Anything | LLM output không bao giờ perfectly valid — phải sanitize → normalize → auto-fix → referential integrity |
| **Temporal Fact Model (valid_at/invalid_at)** | Zep | Không chỉ "khi nào ghi", mà "khi nào fact đúng" — cho phép time-travel query |

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
| **Context Templates** | Zep | Declarative context format per-project, tách format khỏi retrieval logic |
| **Bidirectional evolution (async)** | A-mem | Memory mới có thể enrich memories cũ — implement async để không block store |
| **Semantic triple: keywords+context+tags** | A-mem | Enforce 3 fields này trong schema, LLM extract, không optional |
| **Contextualized document chunking** | Zep | Inject document-level context vào mỗi chunk trước khi ingest |
| **Async-first store (MemScheduler)** | MemOS | store() return ngay, background queue xử lý embedding+graph+dedup |
| **Sidecar Signals** | ByteRover | ranking signals tách riêng khỏi content → no VC pollution, no merge conflicts |
| **Lane Budgeting** | ByteRover | token budget chia theo lanes (decisions/preferences/recent), không flat top-N |
| **Staleness hash** | ByteRover | derived artifacts có children_hash → regenerate on data change, không theo timer |
| **UUID5 deterministic dedup** | cognee | identity fields → UUID5 → same entity = same ID, dedup at DB layer |
| **Typed agent interaction entries** | cognee | TraceEntry, SkillRunEntry — rich semantics cho tool calls và skill execution |
| **Provenance bắt buộc** | cognee | source_pipeline + source_task + content_hash trên mọi record |
| **Agent self-edits memory blocks** | Letta-code | agent rewrite system prompt segments → immediate behavior change, git-tracked |
| **Layered skill priority stack** | Letta-code | Project > Agent > Global > Bundled, override semantics rõ ràng |
| **Dual-mode backend + capability flags** | Letta-code | local-first default, cloud opt-in, same interface |
| **Representation cache layer** | Honcho | Pre-computed compact summary, update khi memory đổi |
| **Temporal search boost** | Hindsight | "Quyết định gần đây nhất về X" query |
| **Disposition traits** | Hindsight | Reflect khác nhau theo context của project |
| **SKILL.md bootstrap prompt** | Superpowers | Dynamic behavior definition, thay vì hardcode |
| **Feedback correction loop** | ICM | Học từ AI prediction sai |
| **Merge wizard** | PURPOSE.md | Nâng local pattern lên global có chủ đích |
| **sqlite-vec + local GGUF fallback** | TencentDB | Offline vector search: GGUF model local, fallback FTS5 khi model chưa ready |
| **`when_to_use` field** | ReMe | Semantic hint cho agent biết dùng memory này trong tình huống nào — khác với keywords (BM25) |
| **JSONL per ngày** | ReMe | Partition tự nhiên theo thời gian, dễ archive, source of truth là file |
| **Temporal decay formula** | memweave | `exp(-ln(2)/half_life_days × age_days)` — đã validate, dùng luôn |
| **Embedding cache (hash→vector)** | memweave | Tránh re-embed cùng content, cheap optimization |
| **Graceful degradation** | memweave, TencentDB | Embedding fail → fallback BM25-only, không crash |
| **Semantic triples (subject-predicate-object)** | Memori | Lưu relation chặt hơn free-form text, query được theo subject/predicate |

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
