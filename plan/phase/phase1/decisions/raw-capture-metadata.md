# Decision: Raw Capture Requires Creator And Classifier Metadata

## Status

Approved and implemented for hook events.

## Context

Smart Memory has two different memory paths:

1. Active storage: user or agent intentionally runs `smem store`.
2. Passive capture: native hooks capture agent console/session events.

These must not be mixed. Passive capture is useful, but it is raw evidence, not an approved memory fact.

## Decision

Every hook-captured event must include metadata:

```json
{
  "captureKind": "raw-input",
  "creator": {
    "kind": "agent-hook",
    "agent": "antigravity"
  },
  "classifier": {
    "kind": "smem-rule",
    "version": "phase1.5",
    "confidence": 0.75
  }
}
```

Capture kinds:

```text
raw-input   -> user/prompt-side or pre-model event
raw-output  -> assistant/output-side or post-model/stop event
tool-event  -> tool call/result event
raw-event   -> unknown native event
```

## Boundary

This classification is offline and rule-based. It does not call an LLM and must be marked as `classifier.kind = smem-rule`.

If a future AI/LLM worker extracts a decision/todo/preference from raw events, that derived memory must record a different classifier, for example:

```text
classifier.kind = llm-extractor
derivedFrom = [raw_event_ids]
```

This keeps auditability clear: raw hook capture, rule classification, and AI-authored memory extraction are separate layers.
