# ECC — Everything Claude Code

## Nó là gì
ECC ("Everything Claude Code") là một **agent harness operating system** — không phải config pack mà là một complete production system: skills, hooks, subagents, rules, MCP configurations, continuous learning, security scanning, và cross-harness orchestration. Được build từ 10+ tháng daily use engineering thực tế. Chạy trên **Codex, Claude Code, Cursor, OpenCode, Gemini, Zed, GitHub Copilot**. v2.0.0 (Jun 2026): 261 skills, 66 agents, 84 legacy command shims.

## Stack kỹ thuật
- **Core**: Node.js >=18, CommonJS, no TypeScript (plain .js)
- **Languages supported**: TypeScript, Python, Go, Java, Kotlin, Dart/Flutter, C++, C#/.NET, Rust, PHP, Perl
- **Install**: npm `ecc-universal`, `ecc-agentshield`; plugin slug `ecc@ecc`; GitHub App
- **ECC 2.0**: Rust control-plane prototype (`ecc2/`) — daemon, session mgmt, cross-harness substrate (alpha, không GA)
- **Dashboard**: Tkinter-based GUI (`ecc_dashboard.py` hoặc `npm run dashboard`)

## Core Components

### Skills — Primary Workflow Surface
```
~/.claude/skills/
  tdd-workflow/          # Multi-file skill với SKILL.md
  security-review/       # Checklist-based skill
  knowledge-ops/         # KB management + sync
```
Skills là durable unit. Commands (`commands/`) chỉ là **legacy slash-entry shims** đang trong quá trình migration sang skills-first. Mỗi skill là markdown với YAML frontmatter (`name`, `description`, `metadata`).

**261 skills** tổ chức theo modules: `security`, `framework-language`, `operator-workflows`, `media-generation`, `business-content`, v.v.

### Agents/Subagents — Delegated Task Execution
```
~/.claude/agents/
  planner.md           # Feature planning
  architect.md         # System design
  code-reviewer.md     # Quality + security
  build-error-resolver.md
  e2e-runner.md
  continuous-learning-v2.md
```
**66 agents**. Mỗi agent có YAML frontmatter: `name`, `description`, `tools`, `model`. Subagents chạy background/foreground với scoped tool permissions.

### Hooks — Trigger-Based Automation
6 hook types:
- `PreToolUse` — before tool executes (validation, blocking)
- `PostToolUse` — after tool finishes (formatting, feedback)
- `UserPromptSubmit` — before user message processed
- `Stop` — when Claude finishes responding
- `PreCompact` — before context compaction
- `Notification` — permission requests

**Runtime controls**: `ECC_HOOK_PROFILE=minimal|standard|strict`, `ECC_DISABLED_HOOKS=hook1,hook2` — không cần edit hook files.

**Hook script pattern**: CommonJS, dùng `run-with-flags.js` wrapper để respect profile/disabled gates. Always exit 0 on non-critical errors.

### Rules — Always-Follow Guidelines
```
~/.claude/rules/
  security.md          # Prompt defense baseline
  coding-style.md      # KISS/DRY/YAGNI, naming
  testing.md           # TDD, AAA pattern, 80% coverage
  git-workflow.md      # Conventional commits
  agents.md            # Delegation rules
  performance.md       # Model selection policy
```

### MCPs — External Service Connectors
**Critical**: Context window = 200k → 70k khi enable quá nhiều. Rule: có 20-30 MCPs configured, nhưng chỉ **< 10 enabled** và **< 80 tools active**.

### Continuous Learning v2.1 — Instinct System
Observer background process (Haiku model) extract **atomic instincts** từ sessions:
```yaml
id: prefer-functional-style
trigger: "when writing new functions"
confidence: 0.7
scope: project          # project-scoped (v2.1)
project_id: "a1b2c3..."
```
Instincts → cluster → evolve into skills/commands/agents. v2.1: **project-scoped** (`~/.local/share/ecc-homunculus/projects/<hash>/`), tránh cross-project contamination. Promote từ project → global khi appear ở 2+ projects.

### Selective Install — Manifest-Driven
`install-plan.js` + `install-apply.js` → install theo modules. State store (SQLite) track what's installed. Profiles: `full`, `minimal`, custom.

## Knowledge Architecture (knowledge-ops skill)
ECC định nghĩa 6-layer knowledge system:
1. **Active execution truth**: GitHub issues/PRs, Linear
2. **Claude Code Memory**: `~/.claude/projects/*/memory/` (markdown + frontmatter)
3. **MCP Memory Server**: Knowledge graph (entities, relations, observations)
4. **Knowledge base repo**: Durable curated notes, session exports
5. **External Data Store**: Supabase/PostgreSQL cho large docs
6. **Local archive folder**: Human-facing notes, không dùng cho live code

Workflow: Classify → Deduplicate (search first!) → Store → Index.

## Điểm mạnh
- **Cross-harness**: Một config set chạy 7+ harnesses — không lock-in
- **Skills-first evolution**: Durable logic trong skills, legacy commands chỉ là shims
- **Continuous learning**: Instinct → cluster → skill tự động, project-scoped
- **Context window awareness**: Rules rõ ràng về MCP/tool limits
- **Hook runtime controls**: Profile + disabled gates không cần edit JSON
- **Production-tested**: 1700+ tests, 10+ months real engineering use
- **Selective install**: Manifest-driven, incremental updates
- **Observer lifecycle**: Session-aware (SessionStart writes lease, SessionEnd removes khi last lease gone)

## Điểm yếu
- **Large surface**: 261 skills, 66 agents → cognitive load lớn khi bắt đầu
- **Node.js-heavy**: Scripts/hooks đều CommonJS, không TypeScript — cần quen
- **ECC 2.0 còn alpha**: Rust control plane build được nhưng chưa GA
- **Migration in progress**: Commands → skills migration chưa xong, hai hệ thống tồn tại song song
- **External runtime dependency**: Một số skills vẫn assume external CLIs (đang được cleanup)
- **Observer complexity**: Dream lock, lease management, re-entrancy guards — nhiều edge cases

## Pattern học cho Smart Memory

### Pattern 1: Skills-First over Commands (★★★★★)
Durable logic sống trong skills (`.md` với YAML frontmatter), commands chỉ là legacy compatibility shims. Áp dụng: memory system nên có "skill" layer (reusable workflows) tách khỏi "command" layer (user-facing shortcuts).

### Pattern 2: Hook Runtime Controls (★★★★★)
`ECC_HOOK_PROFILE` và `ECC_DISABLED_HOOKS` env vars gate hooks ở runtime mà không edit JSON. Pattern này quan trọng: behavior controls nên có runtime switches, không chỉ config-time.

### Pattern 3: Project-Scoped Instincts (★★★★★)
Learned patterns tự động scoped theo project (hash của git remote/repo path). Promote lên global chỉ khi seen ở 2+ projects. Tránh cross-project contamination. Smart Memory nên xem xét project-scoping cho auto-captured memories.

### Pattern 4: Observer Lifecycle với Lease Model (★★★★)
`SessionStart` write project-scoped lease, `SessionEnd` remove lease → stop observer khi no leases remain. Không giữ background processes alive unnecessarily. Ephemeral state không pollute persistent store.

### Pattern 5: 6-Layer Knowledge Architecture (★★★★)
Active truth (GitHub/Linear) → Quick access (memory files) → Semantic (MCP graph) → Durable (KB repo) → Large docs (DB) → Local archive. Mỗi layer có clear ownership rule. Quan trọng: "deduplicate before storing — search first."

### Pattern 6: Context Window Budget Awareness (★★★★)
Explicit rule: < 10 MCPs enabled, < 80 tools active. Memory system nên expose token budget cho agent khi loading context, không inject toàn bộ memory.

### Pattern 7: Instinct Confidence Scoring (★★★)
Atomic instincts có `confidence: 0.3–0.9` thay vì binary. Cluster nhiều low-confidence instincts → một high-confidence skill. Memories nên có quality/confidence dimension.
