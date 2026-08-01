# Decision: Add Candidate Memory Layer

## Status

Approved and implemented for Phase 1.5.

## Context

Raw hook capture is useful but too noisy for normal agent context. Official memory is useful but should not be created blindly from raw console text. Smart Memory needs an intermediate review layer.

## Decision

Add Layer 3: candidate memory.

Pipeline:

```text
raw event
  -> offline classification
  -> candidate memory status=pending-review
  -> user/agent review
  -> promote to official memory status=active
```

Commands:

```bash
smem process
smem candidates
smem promote <candidate-id>
smem reject <candidate-id>
```

## Purpose

Candidate memory is a shortcut for review. It compresses raw event text into a draft memory record with type/title/tags/source metadata, but it is not trusted as official context.

Normal `smem context` and `smem recall` only use official `active` records.

## Metadata

Candidates are stored with:

```text
status = pending-review
sourceKind = raw-capture-candidate
source.rawEventId = evt_...
source.classifier.kind = wink-nlp
```

Promoting a candidate changes status to `active`. Rejecting changes status to `rejected`.

## Boundary

This is still 0-token. Candidate creation uses hook metadata, wink-nlp classification, and rules. It does not call an LLM and should not claim the same authority as explicit user `smem store`.
