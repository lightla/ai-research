# Decision: Add Native Hook Capture

## Status

Approved and implemented for Phase 1.

## Context

Smart Memory needs to capture agent activity without making the agent spend LLM tokens. Hooks are the best default when an agent supports them because hooks receive local JSON events and can write to disk without calling a model.

## Decision

Add native hook install:

```bash
smem install --agent codex --hooks
smem install --agent claude-code --hooks
smem install --agent antigravity --hooks
```

Hook config targets:

```text
codex        -> .codex/hooks.json
claude-code  -> .claude/settings.json
antigravity  -> .agents/hooks.json
```

The hook command is:

```bash
smem hook run --agent <agent> --event <event>
```

It reads JSON from stdin, normalizes basic metadata, classifies a rule-based signal, appends to:

```text
~/.smart-memory/events/pending.jsonl
```

and exits quickly.

## Boundary

This does not call an LLM and does not perform semantic extraction yet.

The first version captures:

- prompt/tool/stop/invocation events exposed by each agent
- session id
- project path when available
- transcript path when available
- low/medium/high rule-based signal
- raw payload for later processing

Automatic "what should be remembered" extraction should be added later as an async worker with review/audit, not inside the synchronous hook.
