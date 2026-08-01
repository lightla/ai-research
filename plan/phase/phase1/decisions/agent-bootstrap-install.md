# Decision: Add Native Agent Bootstrap Install

## Status

Approved and implemented for Phase 1.

## Context

Smart Memory needs a way to onboard agents without requiring the user to manually paste instructions. The project design calls for `smem install` to inject a short bootstrap line into each agent's project instruction file so the agent can discover `smem guide` and `smem context`.

## Decision

Add:

```bash
smem install --agent codex
smem install --agent claude-code
smem install --agent antigravity
smem install --agent all
```

Current native files:

```text
codex       -> AGENTS.md
claude-code -> CLAUDE.md
antigravity -> AGENTS.md
```

The injected block is bounded by `<!-- smem:start -->` and `<!-- smem:end -->`, so it can be safely updated without duplicating content.

## Boundary

This command installs agent bootstrap instructions only. It does not implement hook capture yet and does not store memory inside the project repo.
