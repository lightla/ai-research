# smem Guide

smem is a local Smart Memory tool for agents and users.

Use it to store durable project context, decisions, preferences, errors, and open loops without writing Smart Memory files into the project repo by default.

## First-Time Setup

Run this once from the project root:

```bash
smem init
```

This creates an external memory store under `~/.smart-memory` and maps the current folder to a generated project id.

To use a custom external store:

```bash
smem init --store /path/to/store
```

Install smem bootstrap instructions for agents:

```bash
smem install --agent codex
smem install --agent claude-code
smem install --agent antigravity
smem install --agent all
```

This writes a small bootstrap block to the agent instruction file for the current project. It does not store memory in the repo.

If a project folder moved, do not run `smem init` if you want to keep the old memory id. Go to the new folder and reattach the existing memory project:

```bash
smem move --project-id proj_1Cdc7kZzjtxbsvK1yPkAZu
```

If you only remember the old folder path:

```bash
smem move --from-path /home/light/workspace/pionero/memo
```

This updates the project's active root to the current folder. smem does not keep root path history.

Use `smem list-projects` to see project ids, active roots, and stores.

If `smem init` was accidentally run in the new folder first, that folder is already occupied by a new project id. Delete the accidental project registry entry, then run `move` again:

```bash
smem list-projects
smem del --project-id proj_accidental
smem move --project-id proj_original
```

`smem del` prints the project details and requires you to type the same project id again. It deletes both the registry mapping and that project's memory store directory.

Install native hook capture:

```bash
smem install --agent codex --hooks
smem install --agent claude-code --hooks
smem install --agent antigravity --hooks
```

Hooks capture agent events into `~/.smart-memory/events/pending.jsonl`. This capture is local I/O and does not call an LLM. Captured events are classified by offline NLP/rules, then can be processed into review candidates.

Remove smem bootstrap/hook config from a project:

```bash
smem uninstall --agent codex --hooks
smem uninstall --agent claude-code --hooks
smem uninstall --agent antigravity --hooks
smem uninstall --agent all --hooks
```

Uninstall only removes project instruction blocks and hook config. It does not delete memories under `~/.smart-memory`.

## Memory Layers

smem separates raw capture, classification, candidates, and official memory.

```text
Layer 1: raw event
  - source: native agent hooks
  - file: ~/.smart-memory/events/pending.jsonl
  - purpose: audit trail / raw evidence
  - not trusted as official memory

Layer 2: classified raw event
  - source: raw event + offline wink-nlp/rules
  - fields: captureKind, signal, classification, classifier
  - purpose: cheap 0-token labels/topics/keywords
  - still not official memory

Layer 3: candidate memory
  - source: smem process
  - status: pending-review
  - purpose: shortcut for review; compressed draft memory
  - not returned by normal context/recall until promoted

Layer 4: official memory
  - source: smem store OR smem promote <candidate-id>
  - status: active
  - purpose: stable memory for smem context/recall
```

Hook-captured events are marked separately from active memories:

```text
captureKind: raw-input | raw-output | tool-event | raw-event
creator.kind: agent-hook
classifier.kind: wink-nlp | smem-rule
```

This means passive console/session capture is auditable and not confused with user/agent-authored `smem store` records.

Classify text offline without LLM tokens:

```bash
smem classify "chốt dùng SQLite cho database storage"
```

Process raw captured events into candidate memories:

```bash
smem raw "query"
smem history "query" --after 10
smem process
smem candidates
smem promote <candidate-id>
smem reject <candidate-id>
```

Candidates are shortcuts for review. They are `pending-review` and do not appear in normal `smem context`/`smem recall` until promoted.

In phase 1, `smem process` is manual and exits after one batch. smem does not run a background daemon. Native hooks only run `smem hook run` for each agent event, append the raw event, then exit quickly.

## Raw Review Commands

`smem raw` searches raw hook captures directly. Use it when you want to inspect what hooks captured before anything is processed or promoted.

```bash
smem raw "stest-k001"
smem raw --kind raw-input "remember"
smem raw --full "stest-k001"
smem raw --agent antigravity --json "toolCall"
```

Default `smem raw` prints matched fields and readable snippets. Use `--full` for formatted raw event JSON, or `--json` for the original raw JSONL line.

`smem history` reads like the agent UI: it finds the best transcript match, then prints conversation history from that point onward.

```bash
smem history "stest-k001" --after 10
smem history "stest-k001" --after 10 --full
```

Default `history` output is readable timeline text and hides thinking-only/tool-only/empty command records. Each record is normalized into smem fields like `id`, `fromSource`, `agent`, `role`, and `kind` so agent-specific transcript formats can be adapted consistently. Use `--verbose` to include filtered records, or `--full` when you need paths and original transcript JSON records.

`smem process` reads raw hook captures from `~/.smart-memory/events/pending.jsonl`, filters useful signals, and creates `pending-review` candidate memories. It does not make them official memory.

```bash
smem process
```

Typical output:

```text
scanned=120 created=8 skipped=112
```

`smem candidates` lists those pending-review drafts so a user or agent can inspect them.

```bash
smem candidates
```

Then decide:

```bash
smem promote <candidate-id>  # keep it as official active memory
smem reject <candidate-id>   # discard it as noise
```

Use this flow after a long hooked session:

```bash
smem process
smem candidates
smem promote <candidate-id>
```

Use `smem store` instead when the user or agent already knows exactly what should be remembered.

Layer command summary:

```text
Raw capture:          smem raw "query"
History timeline:     smem history "query" --after 10
Analyzed candidates:  smem process -> smem candidates
Official memory:      smem store OR smem promote; read with smem recall/list/context
```

## Agent Playbook

## Who Uses Which Command

| Command | Used by | When to use | Result |
|---|---|---|---|
| `smem init` | User | Once per project/workspace | Creates outsider project memory mapping |
| `smem list-projects` | User | Need to find saved project ids/active paths | Shows id, active root, and store |
| `smem move --project-id ...` | User | Project folder moved and old project id is known | Moves the active smem root to the current folder |
| `smem move --from-path ...` | User | Project folder moved and old active path is known | Finds old project by active path, then moves active root to current folder |
| `smem del --project-id ...` | User only | Accidental project mapping was created | Prints details, confirms by exact project id, then deletes registry + store |
| `smem install --agent ... --hooks` | User | Once per project per agent | Installs bootstrap + native hook capture |
| `smem uninstall --agent ... --hooks` | User | Removing smem from a project/agent | Removes bootstrap + native hook capture |
| `smem hook run ...` | Agent hook runtime | Called automatically by native hooks | Captures raw events; users normally do not run this |
| `smem guide` | Agent or user | When unsure how smem works | Prints this guide |
| `smem context` | Agent mostly | Start/resume task, "continue", project state questions | Reads official active memory |
| `smem recall "query"` | Agent mostly | Need a specific past decision/topic | Searches official active memory |
| `smem raw "query"` | User or agent | Need to inspect hook-captured raw input/output/tool events | Searches raw capture log, including unpromoted events |
| `smem history "query"` | User or agent | Need to read conversation from a raw match onward | Prints transcript timeline like the agent UI |
| `smem store ...` | Agent or user | User explicitly says remember this, or a clear decision/preference/todo is made | Creates official active memory directly |
| `smem classify "text"` | Agent or developer | Debug/check offline classifier output | Shows 0-token classification result |
| `smem process` | User or agent | After a hooked session, before reviewing passive captures | Converts raw events into pending candidates |
| `smem candidates` | User or agent | Review what passive capture suggests | Lists pending-review memory drafts |
| `smem promote <id>` | User preferred, agent with permission | Candidate is correct and worth keeping | Makes candidate official active memory |
| `smem reject <id>` | User or agent | Candidate is wrong/noisy | Marks candidate rejected |
| `smem index` | User or agent | Before semantic/hybrid vector search | Builds embedding index |
| `smem render` | User mostly | Wants read-only Markdown view | Writes derived Markdown |

Default rule:

```text
Agent reads: context, recall, guide
Agent writes official memory only when user intent is clear: store
Agent may prepare review queue: process, candidates
User should approve uncertain passive capture: promote/reject
No daemon in phase 1: every smem command runs, writes/reads local files or SQLite, then exits
```

If the user asks to continue work or understand project state:

```bash
smem context
```

If the user asks about a specific past decision or topic:

```bash
smem recall "query"
```

If exact wording matters:

```bash
smem recall --mode contains "exact phrase"
```

If meaning matters and embeddings are indexed:

```bash
smem recall --mode hybrid "semantic question"
```

If hooks have been running and the user wants to review what smem captured:

```bash
smem process
smem candidates
```

If a candidate is correct:

```bash
smem promote <candidate-id>
```

If a candidate is wrong/noisy:

```bash
smem reject <candidate-id>
```

If the user explicitly tells the agent to remember something:

```bash
smem store --type decision --title "..." --tags tag1,tag2 "..."
```

Use `smem store` for deliberate memory. Use `smem process` + `smem candidates` for passive hook-captured memory review.

## Core Commands

Check the current project mapping:

```bash
smem status
```

Store a decision:

```bash
smem store --type decision --title "Outsider store" --tags storage,mvp "Default storage does not write files into company repos."
```

Store a global preference shared across projects:

```bash
smem store --scope global --type preference --title "Commit style" "Use conventional commits for AI-authored changes."
```

Store project context:

```bash
smem store --type context --title "Architecture" "SQLite is the canonical store; Markdown is derived render."
```

Store an open loop:

```bash
smem store --type todo --title "Codex hook adapter" "Implement /smem zero-token command interception."
```

List recent records:

```bash
smem list
```

Search memory:

```bash
smem recall "outsider store"
```

Current recall uses SQLite FTS. This is lexical full-text search, not vector semantic search. It is stronger than plain string contains, but it still matches terms rather than meaning.

Choose recall mode explicitly:

```bash
smem recall --mode contains "exact phrase"
smem recall --mode fts "outsider store"
smem index --provider openai
smem recall --mode semantic "why not write files into company repos?"
smem recall --mode hybrid "why not write files into company repos?"
```

`contains` and `fts` are fully local. `semantic` and `hybrid` require embeddings; for the OpenAI provider, set:

```bash
export OPENAI_API_KEY=...
```

Search global memory:

```bash
smem recall --scope global "commit style"
```

Print compact agent context:

```bash
smem context
```

Print compact global context:

```bash
smem context --scope global
```

Render read-only Markdown:

```bash
smem render
```

## When An Agent Should Use smem

Use `smem context` when the user says:

- "continue"
- "what is this project doing?"
- "read project memory"
- "pick up where we left off"
- "what decisions did we make?"

Use `smem recall <query>` when the task needs a specific past decision, convention, error, or rationale.

Use `smem store` after:

- a design decision is made
- an important bug is fixed
- a user preference is stated
- a project convention is established
- an open loop remains for later

Use `smem process` after a long hooked session to convert classified raw events into reviewable candidates.

Use `smem candidates` before promoting anything from passive capture. Do not treat candidates as official memory until promoted.

## Record Types

- `decision`: a choice that should be remembered
- `context`: project background or architecture context
- `todo`: open loop or follow-up
- `preference`: user/team convention
- `error`: resolved or important error
- `note`: general note

## Storage Model

Default mode is outsider storage:

```text
repo:
  no smem files

global registry:
  ~/.smart-memory/registry.sqlite

project store:
  ~/.smart-memory/projects/<project_id>/memory.sqlite

global store:
  ~/.smart-memory/global/memory.sqlite
```

Markdown output is derived. SQLite is the source of truth.

## Custom Guide

You can override this guide by creating:

```text
~/.smart-memory/agent-guide.md
```
