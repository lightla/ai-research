# Phase 5 Backlog

## P0: Management Contract

- [ ] Define versioned read/write API contract for the existing app.
- [ ] Add structured mutation results and validation errors.
- [ ] Add provenance fields for creator, classifier, promoter, editor, and archive actor.
- [ ] Add read-only queue/daemon diagnostics endpoint or adapter.

## P1: Merge And Conflict Review

- [ ] Add local/global memory comparison by normalized content, title, tags, and type.
- [ ] Add duplicate candidate suggestions without automatic merge.
- [ ] Add explicit merge operation preserving source ids and provenance.
- [ ] Add superseded/alias relationships for merged memories.

## P2: Recovery And Integration

- [ ] Add versioned export migrations.
- [ ] Add archive browsing and restore commands.
- [ ] Add integration adapter for the existing web app.
- [ ] Add mutation audit log and recovery tests.

## Risks

- A merge UI can make destructive operations look harmless.
- Content similarity is a suggestion, not proof that two memories are equivalent.
- API contracts can accidentally expose raw sensitive transcripts to broad consumers.
- Global memory can leak project-specific details without scope and provenance filters.
