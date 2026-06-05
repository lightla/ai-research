# ByteRover CLI (brv)

## Nó là gì
ByteRover CLI (`brv`) là một **Hierarchical Context Management Platform** cho AI coding agents — không phải simple memory manager. Core: một **DAG-based Context Tree** của knowledge files, được version-controlled bằng git, với LLM-powered curation engine, multi-tier retrieval, và background consolidation (Dream system). Research-backed: LoCoMo 96.1%, LongMemEval 92.8%.

## Stack kỹ thuật
- **Context Tree**: File-based DAG (markdown files trong `.brv/context-tree/`)
- **Runtime Signals**: Separate sidecar store (không trong markdown)
- **Search**: MiniSearch (BM25) + vector similarity, 4-tier cache
- **Scheduler**: PostWorkRegistry + DreamLockService (serialized per-project)
- **Transport**: Socket.IO (Daemon ↔ TUI/WebUI/CLI)
- **UI**: React/Ink TUI + Vite WebUI
- **Hooks**: 22+ coding agent connectors

## Context Tree — Hierarchical d0-d3 System

```
.brv/context-tree/
├── auth/
│   ├── jwt/
│   │   ├── context.md           (d0: raw content)
│   │   ├── context.abstract.md  (d1: topic summary — LLM-generated)
│   │   └── _index.md            (d2: domain rollup)
│   └── _index.md                (d2: auth domain summary)
└── _index.md                    (d3: root project overview)
```

**Condensation Orders:**
- `d0` — raw context files (original knowledge)
- `d1` — LLM-synthesized topic abstracts
- `d2` — directory rollup (`_index.md` mid-level)
- `d3` — root summary (project-level)

**Summary Frontmatter** (staleness detection):
```typescript
SummaryFrontmatter {
    children_hash: string     // hash of children → detect stale
    compression_ratio: number // output/input tokens
    condensation_order: 0|1|2|3
    covers: string[]          // sorted child names
    covers_token_total: number
    token_count: number
}
```

## Runtime Signals Sidecar — Không ở trong Markdown

**Location:** `<BRV_DATA_DIR>/brv/context-tree/signals/`

```typescript
RuntimeSignals {
    accessCount: number     // # search hits (no manual edits)
    importance: number      // 0-100 (affects manifest selection)
    maturity: 'draft'|'validated'|'core'  // tier based on importance
    recency: number         // 0-1 exponential decay
    updateCount: number     // # curate operations
}
```

**Tại sao tách riêng?** Prevent version control pollution (signals thay đổi mỗi query), no merge conflicts trong team, per-machine ranking.

## Memory Scoring Engine

```typescript
score = 0.6 * bm25 + 0.2 * importance + 0.2 * recency
score *= TIER_BOOST[maturity]

TIER_BOOST = { draft: 0.85, validated: 1.0, core: 1.15 }

recency_decay = exp(-days / 30)
importance_decay = 0.995 ^ days

// Maturity transitions (với hysteresis):
importance >= 85 → CORE   (1.15x)
importance >= 65 → VALIDATED (1.0x)
importance <  65 → DRAFT  (0.85x)
```

## Lane Budgeting — Token-Aware Manifest

```typescript
// Default budgets (configurable):
{ contexts: 4000, stubs: 500, summaries: 2000 }

// Selection:
1. Sort summaries by condensation order (higher = more compressed)
2. Sort contexts by importance (from sidecar)
3. Fill each lane up to budget, highest-scoring first
4. Manifest = active entries + metadata (token counts, paths)
```

Agent nhận đúng context phù hợp với token budget — không dump toàn bộ.

## 4-Tier Query Execution

```
Tier 0 (0ms):       Exact cache hit → return cached
Tier 1 (~50ms):     Fuzzy cache (Jaccard similarity) → return cached
Tier 2 (~100-200ms): BM25 search, no LLM → return formatted results
Tier 3 (~5s):       Smart LLM: pre-fetch top 5 results → inject vào prompt
Tier 4 (8-15s):     Full agentic loop (fallback, rare)
```

**Smart Routing**: Run search first → nếu top score ≥ 0.7 → pre-fetch top 5 → inject vào LLM prompt (optimized). Giảm agentic loop từ 30% → 5% queries.

## ACE Curator Operations

```
ADD     → create new context file, seed sidecar với defaults
UPDATE  → modify file, importance += 5, recency = 1, maturity recomputed
UPSERT  → ADD nếu thiếu, UPDATE nếu có
MERGE   → combine 2 items, importance = max(), accessCount = sum()
DELETE  → remove file + sidecar entry
```

**4-Phase Curation:**
1. Preprocessing (file ref validation, HTML/PDF extract)
2. Pre-compaction (compress nếu cần: remove comments → summarize code → pass-through)
3. Curation (agent loop: recon + curate tool)
4. Post-finalization (diff snapshot → summary propagation → manifest rebuild → dream counter) — **serialized per-project**

## Dream System — Background Consolidation

**Operations:**
- **Synthesize**: Regenerate stale d1-d2-d3 summaries
- **Consolidate**: Merge similar d0 files → single d1 abstract
- **Prune**: Archive rarely-used files (draft + low importance)
- **Archive**: Move to `.archive/` + create ghost cue stubs

**Safety:** DreamLockService prevents concurrent dream + curate writes. `dream-undo.ts` để restore pre-dream snapshots. HITL review via `brv review reject`.

## Lifecycle Hooks — Multi-Agent Integration

```
UserPromptSubmit  → inject context + rules trước khi agent xử lý
BeforeToolUse     → pre-hook tool calls
PostToolUse       → capture results
Stop              → prevent early termination
SessionStart/End  → lifecycle boundaries
```

Rules connector: inject `<!-- BEGIN/END BYTEROVER RULES -->` markers vào agent config files (Cursor, OpenCode, v.v.) — non-destructive, per-agent segment.

## BM25 với MiniSearch

```typescript
Index fields: { title: 3x, path: 1.5x, content: 1x }
Fuzzy: 0.2 tolerance
Normalization: score = raw / (1 + raw)
Gap filter: score >= 0.7 * max_score

// Symbol Tree: parent-child relationships
// Score propagation: child match → parent gets 0.55x boost per level
```

## Điểm mạnh
- **Hierarchical d0-d3 summaries**: Progressive compression, auto-regenerate khi stale
- **Sidecar signals**: Runtime signals không pollute version control
- **4-tier query**: Từ 0ms cache đến full agentic — optimize for common case
- **Lane budgeting**: Token-aware selection, không dump toàn bộ context
- **Dream background system**: Autonomous consolidation + HITL review
- **ACE operations**: Structured curation, không free-form
- **Staleness detection**: `children_hash` detect khi summaries cần regenerate
- **Strong benchmarks**: LoCoMo 96.1%, LongMemEval 92.8% (production code, không research prototype)

## Điểm yếu
- **File-based, không SQL**: Không có query language, không cross-file join
- **Git dependency**: Cần git cho version control và team sharing
- **LLM curation**: Mỗi curate operation gọi LLM → latency + cost
- **Không có global/local project boundary**: Single tree per project
- **Phức tạp**: Dream + PostWorkRegistry + Signals sidecar + Lane budgeting — nhiều moving parts

## Pattern học cho Smart Memory

### Pattern 1: Sidecar Signals — Tách Ranking khỏi Content (★★★★★)
Ranking signals (importance, recency, accessCount, maturity) lưu riêng khỏi memory content. Không pollute git history, không merge conflicts, per-machine nếu cần. Smart Memory nên tách `weight` + `access_count` ra separate table, không embed trong memory record chính.

### Pattern 2: Lane Budgeting — Token-Aware Selection (★★★★★)
Thay vì return top-N results, allocate token budget theo lanes (decisions: 2000 tokens, preferences: 500 tokens, recent: 1000 tokens). Manifest-based selection đảm bảo luôn nằm trong budget.

### Pattern 3: Staleness Detection qua Content Hash (★★★★)
Mỗi derived artifact (summary, representation cache, wake_up pack) có `children_hash`. Khi children thay đổi → hash mismatch → trigger regenerate. Không regenerate khi không cần.

### Pattern 4: 4-Tier Query với Pre-fetch (★★★★)
Cache → BM25 → Pre-fetch + optimized LLM → Full agentic. Pre-fetch trick: chạy search trước, inject top results vào LLM prompt → giảm dramatically số lần cần full agentic loop.

### Pattern 5: Maturity Tiers với Hysteresis (★★★)
draft → validated → core dựa trên importance score, với hysteresis bands. Tránh oscillation. Memory thường-được-dùng tự nhiên nâng tier, ít-dùng tự nhiên hạ tier.
