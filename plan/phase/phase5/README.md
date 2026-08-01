# Phase 5: Management Integration And Merge

Phase 5 is the management layer after retrieval and automation are proven. The existing web application is treated as a consumer of smem data; this phase does not rebuild that application.

## Goal

Give users a safe way to inspect, edit, compare, merge, and recover memories across local and global scopes without touching raw capture history or writing unwanted files into project repositories.

## Scope

1. Management API/contract

Provide a stable local API or service boundary for the existing app:

- list/search memories;
- inspect provenance and source metadata;
- edit/archive/promote/reject with permission checks;
- read queue and daemon diagnostics;
- export/import with schema versioning.

2. Provenance and lifecycle

Track who created, classified, promoted, edited, archived, or rejected a record. Keep `creator` and `classifier` distinct, especially for passive hook captures.

3. Local/global merge

Add a reviewable merge workflow for project-local and global memories. Never silently overwrite a record with the same meaning; show conflicts and preserve both source ids until a user chooses.

4. Recovery and audit

Expose archive files, export history, source event ids, and superseded records. Destructive actions need explicit confirmation and must be recoverable where practical.

## Non-goals

- Rebuilding the existing web UI.
- Team/cloud sync by default.
- Automatic promotion or automatic conflict resolution.
- Deleting raw transcript history as part of merge.

## Completion Criteria

Phase 5 is complete when the existing app can consume a versioned management contract, every mutation has provenance, local/global merge is reviewable and conflict-safe, and export/archive recovery is covered by tests.
