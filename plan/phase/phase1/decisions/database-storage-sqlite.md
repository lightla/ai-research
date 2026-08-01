# Decision: Database Storage Is SQLite

## Status

Approved for Phase 1.

## Context

Smart Memory needs a local, fast, single-machine database for registry, memory records, FTS search, and later event queues. The database should be easy for AI to understand and debug.

## Decision

Use SQLite as the Phase 1 database storage.

The current implementation uses Node.js built-in `node:sqlite` because it avoids external native package installation issues. Node still reports this API as experimental, so the CLI suppresses the specific SQLite experimental warning for user-facing commands.

## Boundary

The design decision is **SQLite storage**, not a permanent commitment to one Node binding.

Allowed future bindings:

- `node:sqlite`
- `better-sqlite3`
- another stable SQLite binding

The schema, migrations, and repository functions should remain portable enough that the binding can be swapped if needed.
