# Understand-Anything

## Nó là gì
Understand-Anything là một codebase analysis tool kết hợp static analysis (tree-sitter) và LLM để tạo ra **interactive knowledge graph** của một project. Mục tiêu: biến 200,000 dòng code thành một đồ thị có thể navigate được — "quietly teaches you how every piece fits together."

Không phải memory system, nhưng chứa nhiều pattern kỹ thuật cực kỳ có giá trị cho Smart Memory, đặc biệt ở phần graph data model và incremental update.

## Stack kỹ thuật thực tế
- **Monorepo (pnpm workspaces)**: `core/`, `dashboard/`, `skill/`
- **Static analysis**: tree-sitter (WASM) cho 12 ngôn ngữ
- **Graph store**: JSON file `.understand-anything/knowledge-graph.json` — committable, git-friendly
- **Search**: Fuse.js (fuzzy, threshold 0.4) + cosine similarity (semantic)
- **Dashboard**: React 18 + React Flow + Monaco Editor + TailwindCSS v4
- **State**: Zustand + localStorage persistence
- **Schema validation**: Zod-based 4-tier pipeline
- **Multi-agent**: 7 specialized agents với clear I/O contracts
- **Pipeline scripts**: Node.js + Python utilities

## Graph Data Model

### Node System — 21 loại, 4 nhóm
```
Code nodes:        file, function, class, module, concept
Non-code nodes:    config, document, service, table, endpoint, pipeline, schema, resource
Domain nodes:      domain, flow, step
Knowledge nodes:   article, entity, topic, claim, source
```

Node ID format: `<prefix>:<path>:<name>` — ví dụ `function:src/auth.ts:login`

```typescript
GraphNode {
  id, type, name, filePath, lineRange,
  summary,          // LLM-generated, plain English
  tags: string[],   // searchable
  complexity: "simple" | "moderate" | "complex",
  languageNotes,    // language-specific patterns
  domainMeta: {     // business domain context
    entities, businessRules, crossDomainInteractions,
    entryPoint, entryType
  },
  knowledgeMeta: { wikilinks, backlinks, category, content }
}
```

### Edge System — 35 loại, 8 nhóm
```
Structural:      imports, exports, contains, inherits, implements
Behavioral:      calls, subscribes, publishes, middleware
Data flow:       reads_from, writes_to, transforms, validates
Dependencies:    depends_on, tested_by, configures
Semantic:        related, similar_to
Infrastructure:  deploys, serves, provisions, triggers
Schema/Data:     migrates, documents, routes, defines_schema
Domain:          contains_flow, flow_step, cross_domain
Knowledge:       cites, contradicts, builds_on, exemplifies, ...
```

Edge có: `weight` (0-1), `direction` (forward/backward/bidirectional)

## Cơ chế thực tế đáng chú ý

### 4-Tier Schema Validation Pipeline
```
Tier 1 (Sanitize):  null → undefined cho optional fields
Tier 2 (Normalize): alias resolution (func→function, method→function, struct→class)
Tier 3 (Auto-fix):  default missing fields (type→"file", direction→"forward")
Tier 4 (Referential integrity): drop nodes without ID, drop dangling edges
```
Kết quả: LLM output dù malformed vẫn trở thành valid JSON sau pipeline này.

### Fingerprinting — Incremental Update Engine
```typescript
FileFingerprint {
  contentHash: SHA-256,         // exact match → SKIP
  functions: [{ name, params, returnType, exported, lineCount }],
  classes: [{ name, methods, properties }],
  imports: [{ source, specifiers }],
}

Change classification:
  contentHash đồng nhất      → NONE (skip analysis)
  hash khác, signatures đồng → COSMETIC (skip LLM call)
  signatures khác            → STRUCTURAL (re-analyze)

Update scope:
  0 structural files   → SKIP
  1-10 structural      → PARTIAL_UPDATE (chỉ re-analyze files thay đổi)
  11-30 structural     → ARCHITECTURE_UPDATE (+ re-run arch analyzer)
  30+ hoặc >50% files  → FULL_UPDATE
```

### 7-Phase Multi-Agent Pipeline
```
Phase 0: Pre-flight  → resolve root, git hash, plugin verify
Phase 1: Scanner     → file enumeration (git ls-files) + import map (12 languages)
Phase 2: File Analyzer → parallel batches (5 concurrent, 20-30 files/batch)
          Deterministic: tree-sitter extraction
          LLM: summaries, tags, semantic relations, language lessons
Phase 3: Assemble    → Python merge-batch-graphs.py + optional LLM review
Phase 4: Architecture → directory grouping + LLM assigns 3-10 layers
Phase 5: Tour Builder → topological sort → guided learning path
Phase 6: Final       → combine all → sanitize paths → open dashboard
```

### Search Engine (Dual-Mode)
```
Fuzzy (Fuse.js):   weights: name(0.4) > tags(0.3) > summary(0.2) > languageNotes(0.1)
                   extended: "auth contrl" → "auth | contrl" (OR)
                   threshold: 0.4

Semantic:          cosine similarity trên pre-computed embeddings
                   fallback khi không có embeddings
```

### Context-Aware Chat
```
buildChatContext(query):
  1. search graph → top N nodes
  2. expand 1 hop via edges (related nodes)
  3. collect associated architectural layers
  4. format as Markdown → inject vào LLM prompt
```

## Kỹ thuật từ source code

### Committable JSON Graph
Graph lưu tại `.understand-anything/knowledge-graph.json` trong project directory — có thể commit vào git. Teammates clone về không cần re-run analysis.

### Test-to-Production Auto-Linking
`merge-batch-graphs.py` tự detect file test (`*.test.ts`, `*_spec.rb`, `test_*.py`) và tạo `tested_by` edge về file production tương ứng. Không cần LLM.

### Persona-Adaptive UI
3 personas: non-technical / junior dev / experienced dev. Mỗi persona thay đổi layout, panel visibility, thông tin hiển thị. Persisted vào localStorage.

### Domain Graph Layer
Separate hierarchy: `domain → flow → step` cho business logic. Tách bạch với code structure graph. Cho phép query theo business intent, không chỉ theo code structure.

## Điểm mạnh
- **Hybrid deterministic + LLM**: tree-sitter cho structure (reproducible), LLM cho meaning (flexible) — rõ ràng vai trò
- **Incremental fingerprinting**: chỉ re-analyze khi cần, không brute-force toàn bộ
- **Alias resolution**: chuẩn hóa LLM output về canonical schema, không mất semantic intent
- **Referential integrity**: validate + auto-fix trước khi persist — graph không bao giờ corrupt
- **Committable artifact**: team chia sẻ knowledge graph qua git, không phải mỗi người tự analyze
- **21 node types + 35 edge types**: đủ expressiveness cho cả code + business + knowledge
- **Domain node hierarchy**: business logic được model riêng, không trộn với code structure
- **Multi-platform**: cùng một graph format deploy trên Claude Code, Cursor, Copilot, v.v.

## Giới hạn
- **JSON file không scale**: graph > 10MB cần git-lfs; không có query language
- **Dashboard O(n) search**: fuzzy + semantic đều là linear scan, chậm với >5,000 nodes
- **React Flow scalability**: force simulation expensive với >5,000 nodes — không có clustering hay viewport culling
- **Không phải memory system**: không có decay, versioning, lifecycle hooks, hay session continuity
- **One-time analysis**: không capture runtime behavior, chỉ static structure
- **Dynamic imports không track**: `require(variable)` bỏ qua
- **Test detection fragile**: dựa trên naming convention, không robust với non-standard layout

## Mức độ phù hợp với mục tiêu Smart Memory

Không dùng trực tiếp (khác use case), nhưng **kế thừa 4 pattern quan trọng**:

### Pattern 1: Graph Data Model cho Smart Macro-Graph
Domain node hierarchy (`domain → flow → step`) là reference tốt nhất cho Smart Macro-Graph. Tách business node khỏi code node, có relation types rõ ràng.

### Pattern 2: Fingerprinting cho Incremental Memory Update
Khi Smart Memory "learns" a project (`smem learn`), dùng fingerprinting để chỉ re-index phần thay đổi. Không re-scan toàn bộ mỗi lần.

### Pattern 3: 4-Tier Schema Validation
Mọi LLM output phải qua: sanitize → normalize → auto-fix → referential integrity. Áp dụng khi agent store memory — validate trước khi persist.

### Pattern 4: Alias Resolution
LLM hay viết `func`, `method`, `struct` thay vì canonical types. Cần normalize table giống Understand-Anything để memory records không bị phân mảnh do naming inconsistency.
