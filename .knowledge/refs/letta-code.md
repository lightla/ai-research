# Letta-Code

## Nó là gì
Letta-code là một **memory-first agent harness** cho long-lived coding agents. Không phải vanilla Letta — đây là variant TypeScript chuyên biệt cho CLI/coding agents, chạy trên Bun runtime, với git-backed memory system (MemFS), 11-event hook system, và dual-mode backend (API + local). Core innovation: **agent tự edit system prompt của chính mình** (memory blocks) để học từ experience.

## Stack kỹ thuật
- **Runtime**: Bun + TypeScript
- **UI**: React/Ink TUI
- **Memory**: MemFS (git-backed filesystem projection)
- **Backend**: Dual — Letta API (remote) hoặc Local in-process server
- **Search**: Vector (embedding) + FTS (keyword), dual-mode
- **LLM**: Multi-provider (Claude, GPT, Gemini, GLM, Kimi, v.v.)

## 3-Tier Memory Model

### Tier 1: In-Context Memory Blocks
```
Editable segments của system prompt.
Agent tự rewrite để modify behavior cho invocations sau.
```
- `persona.md`, `goals.md`, v.v. — human-readable
- References via `[[path]]` links (synapses) liên kết context
- Immediate effect: thay đổi xảy ra ở invocation tiếp theo
- Git-tracked → reversible, auditable

### Tier 2: Recall Memory (Message History)
- Tất cả conversation history → store tự động
- Agent không modify trực tiếp
- Searchable via `/search` hoặc `recall` subagent
- Vector + FTS dual-mode

### Tier 3: External Memory (Skills & Files)
```
~/.letta/agents/{id}/memory/
├── system/        # in-context blocks
├── skills/        # procedural memory (SKILL.md files)
├── reference/     # general context files
└── .git/          # tracks all changes
```

## MemFS — Git-Backed Memory Projection

```
Memory blocks (system prompt)
    ↓ projected to
Local filesystem (MemFS)
    ↓ agent edits via file operations
git commit → git push
    ↓
Remote server (API mode) or local (local mode)
```

Agent có thể `git log`, `git revert`, inspect history. Full version control cho memory.

**2 modes:**
- **Remote MemFS**: Clone từ `$LETTA_MEMFS_BASE_URL/v1/git/$AGENT_ID/state.git`
- **Local MemFS**: Stored in local process directory, commit tracked locally

## Hook System — 11 Lifecycle Events

```
Tool Events (với matcher patterns):
  PreToolUse            ← CAN BLOCK (exit code 2)
  PostToolUse           ← cannot block, feedback to agent
  PostToolUseFailure    ← cannot block, stderr fed back
  PermissionRequest     ← CAN auto-allow/deny

Simple Events:
  UserPromptSubmit      ← CAN BLOCK
  Notification          ← cannot block
  Stop                  ← CAN BLOCK
  SubagentStop          ← CAN BLOCK
  PreCompact            ← cannot block
  SessionStart          ← inject context vào first message
  SessionEnd            ← cannot block
```

**2 Hook Types:**
```yaml
# Command hook
type: command
command: "my-script.sh $ARGUMENTS"
timeout: 60000

# Prompt hook (LLM-evaluated)
type: prompt
prompt: "Should this action be allowed? $ARGUMENTS"
model: "anthropic/claude-sonnet-4-6"
```

**Exit codes:** 0=ALLOW, 1=ERROR, 2=BLOCK

**Execution:** Blocking hooks run sequentially, stop on first BLOCK. Non-blocking run parallel, all feedback collected.

## Skill System — Layered Priority

```
Project skills  (.skills/ in cwd)       ← HIGHEST PRIORITY
Agent skills    (~/.letta/agents/{id}/memory/skills/)
Global skills   (~/.letta/skills/)
Bundled skills  (embedded in package)   ← LOWEST PRIORITY
```

**SKILL.md format:**
```markdown
---
id: "web-scraper"
name: "Web Scraper"
when_to_use: "When you need to extract structured data from websites"
disable-model-invocation: false
user-invocable: true
category: "web"
tags: ["web", "scraping"]
---
# Implementation content...
```

Discovery: recursive scan for `SKILL.MD` files, ID từ directory path.

## Subagent System

**Modes:** `stateful` (persist memory) hoặc `stateless` (no persist)

**Built-in subagents:**
- `recall` — search past experience
- `reflection` — reflect + plan
- `memory` — memory management
- `general-purpose` — general assistant
- `init`, `fork`, `history-analyzer`

**Custom subagents:** `.letta/agents/*.md` (markdown với frontmatter)

Subagents có riêng memory block access, tool whitelist, recommended model.

## Dual-Mode Backend

```typescript
BackendCapabilities {
    remoteMemfs: bool         // sync to remote git
    serverSideToolManagement: bool
    serverSecrets: bool
    agentFileImportExport: bool
    localModelCatalog: bool
    localMemfs: bool          // local git storage
}
```

Same codebase, same interface → switch via `--backend api|local` flag. Local mode: không cần login, full privacy.

## Retrieval — Hybrid Vector + FTS

```
Vector search:  semantic similarity (requires API backend)
FTS search:     BM25 keyword matching (works on local + API)
Hybrid:         combine both engines

/search command → search all messages across all agents
searchMessagesForBackend() → programmatic
warmMessageSearchCacheForBackend() → pre-warm vector cache
```

## Điểm mạnh
- **Self-modifying system prompt**: Agent edit memory blocks = immediate behavior change. Không cần fine-tune, không cần prompt engineering — agent tự làl
- **Git-backed MemFS**: Memory có full version control. `git log`, `git revert`, collaborative editing
- **11-event hook system**: Granular lifecycle control, cả command và LLM-evaluated hooks
- **Layered skill discovery**: Project > Agent > Global > Bundled, với override semantics rõ ràng
- **Dual-mode backend**: Same code, local-first hoặc remote — không lock-in
- **Multi-LLM**: Claude, GPT, Gemini, GLM, Kimi — không vendor lock

## Điểm yếu
- **Git dependency**: MemFS cần git — thêm operational complexity
- **Bun-specific**: Không portable sang Node.js
- **Remote MemFS cần login**: Local mode limited features
- **Recall memory không directly editable**: Agent phải dùng subagent để access conversation history
- **Không có structured memory schema**: Memory blocks là free-form markdown — không typed

## Pattern học cho Smart Memory

### Pattern 1: Agent Self-Edits Its Own Context (★★★★★)
```
Agent viết vào memory blocks = agent tự thay đổi system prompt của mình.
Không cần fine-tune. Immediate effect. Human-readable. Git-tracked.
```
Đây là cách thực hiện "không nhắc lại" cấp cao nhất: agent **tự nhớ** bằng cách rewrite prompt của chính nó. Smart Memory có thể implement dưới dạng "writable context blocks" — agent có thể update một số sections của system prompt, version-controlled.

### Pattern 2: Layered Skill Override với Priority Stack (★★★★)
Project > Agent > Global > Bundled. Mỗi layer override layer dưới. Smart Memory's behavior definitions (SKILL.md) nên có cùng hierarchy: project-level overrides agent-level, không phải merge tất cả.

### Pattern 3: Dual-Mode Backend với Capability Flags (★★★★)
Không phải "cloud-only" hay "local-only". Cùng interface, backend flags quyết định features. Smart Memory nên có `BackendCapabilities` — local mode có subset features, remote mode có full features.

### Pattern 4: Blocking Hooks cho Permission Control (★★★)
`PreToolUse` hook có thể BLOCK. Áp dụng cho Smart Memory: hook có thể block store nếu content vi phạm rules (PII, secret, v.v.). LLM-evaluated hooks đặc biệt powerful: "Should this memory be stored? $CONTENT" → LLM decides.

### Pattern 5: Git Memory cho Team Collaboration (★★★)
MemFS git-backed: teammates clone cùng repo → share memory state. Áp dụng cho Smart Memory project config: commit `project_id` + memory snapshot vào git → team sync.
