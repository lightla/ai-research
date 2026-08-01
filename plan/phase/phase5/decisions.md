# Phase 5 Decisions

## Existing App Is A Consumer

The current web app should consume a stable smem management contract. smem remains the source of truth and the app must not write directly to SQLite.

## Merge Is Reviewable

Similarity may suggest duplicates, but only an explicit user action can merge or supersede records. Original ids and raw source references remain recoverable.

## Scope Is A Security Boundary

Local and global memories must be filtered explicitly. A global context request must not automatically expose project-local content, and a project request must not silently mutate global memory.

## Provenance Is Mandatory

Every mutation records actor and reason metadata. Offline classification is not treated as user approval, and passive capture is never presented as deliberately authored memory.
