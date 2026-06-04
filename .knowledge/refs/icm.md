# ICM (Infinite Context Memory)

## Nó là gì
ICM là một hệ memory persistent viết bằng **Rust**, kết hợp hai lớp lưu trữ: Memory (decay-based) và Memoir/Concept (permanent knowledge graph). Expose qua MCP server cho Claude Code. Không có lifecycle hooks tự động — agent phải chủ động gọi tool.

## Stack kỹ thuật thực tế
- **Rust workspace** (4 crates): `icm-core`, `icm-store`, `icm-mcp`, `icm-cli`
- **SQLite + sqlite-vec** (qua libsql/Turso): local storage + vector similarity
- **FastEmbed**: local embeddings (no cloud dependency)
- **FTS5**: full-text search (BM25) built into SQLite
- **MCP server**: stdio transport cho Claude Code

## Hai lớp Memory

### Layer 1: Memory (có decay)
```rust
struct Memory {
    id: String,           // ULID
    topic: String,        // namespace (e.g. "decisions-api", "preferences")
    summary: String,      // nội dung
    keywords: Vec<String>,
    importance: Importance,  // Critical/High/Medium/Low
    weight: f32,          // 1.0 → decay theo ngày
    embedding: Vec<f32>,  // optional
    related_ids: Vec<String>,  // auto-link edges
    scope: Scope,         // User/Project/Org
}
```

Decay multipliers theo importance:
- `critical` = 0.0 (không decay)
- `high` = 0.5 (decay 2x chậm hơn)
- `medium` = 1.0 (decay bình thường)
- `low` = 2.0 (decay 2x nhanh hơn)

### Layer 2: Memoir + Concept (permanent)
```rust
struct Concept {
    memoir_id: String,
    name: String,
    definition: String,
    labels: Vec<Label>,     // namespace:value
    confidence: f32,        // 0-1, tăng khi refine
    revision: u32,          // bumps mỗi lần refine
}
```

Relations giữa concepts:
`PartOf`, `DependsOn`, `RelatedTo`, `Contradicts`, `Refines`, `AlternativeTo`, `CausedBy`, `InstanceOf`, `SupersededBy`

## Search Pipeline (tool_recall)

```
1. Hybrid (nếu có embedder):
   embed(query) → search_hybrid(BM25 + vector) → filter(project, topic, keyword)
   → expand_with_neighbors(related_ids, 1 hop, discount=0.5) → re-filter
   → batch_update_access()

2. Fallback:
   search_fts(FTS5 BM25) → nếu rỗng: search_by_keywords()
   → filter → expand_with_neighbors → re-filter
```

Graph expansion: mỗi primary hit kéo thêm `limit/3` neighbors từ `related_ids` với score × 0.5.

## Cơ chế đặc biệt

### Auto-dedup khi store
```rust
const DEDUP_SIMILARITY_THRESHOLD: f32 = 0.85;
// similarity > 0.85 và cùng topic → update thay vì tạo mới
```

### Auto-link khi store
Memory mới được tự động linked với similar memories trong DB (`related_ids`). Sau đó back-refs được update.

### Auto-consolidate (threshold = 10)
Topic > 10 entries → tự động gọi `auto_consolidate_with_embedder`. Consolidated memory được embed inline (fix bug: trước đó consolidated memory không có embedding).

### icm_wake_up — session start context pack
```
Inputs: project, max_tokens (200 default, clamped 20-4000), format, include_preferences
Process: select critical/high memories + preferences → rank by importance × recency × weight → truncate to token budget
```

### icm_learn — project scanner
Scan project directory → tạo Memoir với concepts:
- **project identity**: đọc Cargo.toml/package.json/pyproject.toml/go.mod
- **dependencies**: top 15 deps từ manifest
- **modules**: workspace members hoặc src/ subdirs
- **entrypoints**: main.rs, lib.rs, index.ts, main.py, main.go, v.v.
- **configs**: GitHub Actions, Docker, CI files
- **scripts**: Makefile, justfile, scripts/ directory

Relations được tạo: `PartOf` (modules→project), `DependsOn` (project→deps), `RelatedTo` (config/script→project)

### icm_feedback_record / search
Học từ AI corrections: lưu context + predicted + corrected + reason → search trước khi predict.

### icm_transcript_*
Verbatim session replay: record messages → search via FTS5 → replay chronologically.

## Tool Surface (30 tools tổng)

**Memory**: `store`, `recall`, `forget`, `forget_topic`, `update`, `consolidate`, `list_topics`, `stats`, `health`, `extract_patterns`, `embed_all`

**Memoir**: `create`, `list`, `show`, `add_concept`, `refine`, `search`, `search_all`, `link`, `inspect`, `export`

**Utility**: `learn`, `wake_up`

**Feedback**: `feedback_record`, `feedback_search`, `feedback_stats`

**Transcript**: `transcript_start_session`, `transcript_record`, `transcript_search`, `transcript_show`, `transcript_stats`

## Điểm mạnh
- **Rust performance**: fast, no GC pauses, type-safe
- **Local-first hoàn toàn**: SQLite + local embeddings, không cần cloud
- **Hai lớp memory tách biệt**: Memory (ephemeral/decay) vs Memoir (permanent/refine)
- **Graph-aware recall**: graph expansion tự động qua related_ids
- **icm_wake_up**: token-budgeted context pack cho session start — ngắn gọn và hiệu quả
- **Auto-dedup**: similarity check trước khi create new memory
- **Memoir export**: json/dot/ascii/ai formats — dùng với Graphviz hoặc inject trực tiếp vào LLM

## Điểm yếu — Hook System (lý do không ưa)

### Vấn đề cốt lõi: HOÀN TOÀN thủ công
Không có lifecycle hooks tự động (không có SessionStart/PostToolUse/SessionEnd như claude-mem). Agent phải tự nhớ:
1. ToolSearch deferred tools tại đầu session
2. Gọi `icm_wake_up` trước mọi công việc
3. Gọi `icm_memory_store` khi có error resolved / decision / preference / task done / 20 tool calls
4. Gọi `icm_memory_recall` khi gặp vấn đề tương tự

**Hệ quả**: nếu agent không tuân thủ (vì distracted bởi task), context bị mất. Không có safety net.

### Project boundary fragile
`recall` filter project bằng `cwd.file_name()` (basename của thư mục hiện tại). Nếu agent chạy từ thư mục con hoặc basename trùng nhau → filter sai, memory leak cross-project.

### `icm_learn` tạo Hairball
Scanner tạo concepts cho từng entrypoint, script, CI file (e.g., `.github/workflows/cd.yml`, `scripts/bench-agent-sim.ts`) → đúng là vấn đề mà PURPOSE.md gọi là Hairball Problem. Không phân biệt macro-node (Module/Decision) với micro-node (file lẻ).

### Không có global/local boundary thực sự
Scope `User/Project/Org` chủ yếu phục vụ cloud sync, không phải local boundary. Locally tất cả đều nằm trong cùng một SQLite file.

### Consolidation không có versioning
`consolidate_topic` xóa tất cả memories trong topic và tạo một memory mới. Không có `parentId`, không có `supersedes[]`, không có audit trail. Memory evolution history bị mất.

### Decay thụ động
`maybe_auto_decay` chỉ chạy khi recall (>24h since last decay). Không có background scheduler, không có cron. Memory không decay đúng khi không có ai recall.

### No Situational Query
Không có context layer trả về "tại sao" (rationale, trade-offs, constraints). `icm_memory_recall` chỉ trả `summary` — không có cấu trúc `bối cảnh → ràng buộc → quyết định`.

## Mức độ phù hợp với mục tiêu của bạn
- **Kế thừa**: `icm_wake_up` pattern (token-budgeted session start pack), dual-layer Memory/Memoir, auto-dedup, Rust performance, local-first SQLite
- **Không kế thừa**: hook system thủ công (thay bằng automated lifecycle như claude-mem), `icm_learn` Hairball (thay bằng Smart Macro-Graph), thiếu global/local boundary
- **Cần thêm**: memory versioning (parentId/supersedes), Situational Query layer, merge wizard
