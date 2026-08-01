# Phase 4 Decisions

## Optional Daemon

The daemon is opt-in. Native hooks remain short-lived and continue to work without a resident process.

## Append-Only Raw Queue

The daemon never removes raw events. Candidate deduplication uses source event ids, so retrying a batch is safe and recoverable.

## One Home, One Worker

The lock and pid metadata live under the configured Smart Memory home. This prevents separate daemon instances from processing the same SQLite stores concurrently.
