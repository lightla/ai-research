# Decision: Add Global Memory Scope

## Status

Approved and implemented for Phase 1.

## Context

Smart Memory needs both local project memory and global memory. Local memory belongs to one project. Global memory stores cross-project conventions, user preferences, reusable workflows, and general agent guidance.

## Decision

Add `--scope local|global` to memory commands:

```bash
smem store --scope global --type preference --title "Commit style" "Use conventional commits."
smem list --scope global
smem recall --scope global "commit style"
smem context --scope global
smem render --scope global
```

Local remains the default.

## Storage

Local memory:

```text
~/.smart-memory/projects/<project_id>/memory.sqlite
```

Global memory:

```text
~/.smart-memory/global/memory.sqlite
```

Global memory does not depend on a specific project store. It still uses the same record schema, with `project_id = global` and `scope = global`.

## Rationale

- Keeps global/local boundaries explicit.
- Avoids mixing project-specific facts into global context by default.
- Preserves outsider storage: no files are written into the project repo.
- Keeps Phase 1 implementation simple by reusing the same repository/schema.
