# Phase 4: Hooks And Automation

Phase 4 automates the already-proven capture and candidate pipeline. It does not change the official-memory boundary: raw capture stays append-only, offline classification creates review candidates, and promotion remains explicit.

Current status: daemon P0, queue diagnostics, skip-reason reporting, and transcript fallback capture are implemented and verified. Retention policy, service-manager integration, and lifecycle fixture coverage remain follow-up work.

## Goal

After hooks are installed, smem can process captured input/output events continuously without blocking the agent or spending LLM tokens.

## Runtime

```text
agent hook
  -> smem hook run
  -> append normalized raw event
  -> return immediately

smem daemon run
  -> acquire one process lock
  -> scan pending raw events
  -> offline classify/filter/dedupe
  -> create pending-review candidates
  -> repeat on interval
```

The daemon is optional. A user can keep the existing one-shot hook worker or run the daemon explicitly for long sessions.

## Commands

```bash
smem daemon once
smem daemon run --interval 1000
smem daemon status
smem daemon stop
```

`run` is a foreground process suitable for a service manager. `once` processes one batch and exits. `status` reads the local pid/metadata file. `stop` sends a normal termination signal and does not delete raw data.

## Safety Rules

- No LLM calls in hook or daemon processing.
- No automatic candidate promotion.
- No raw-event deletion by the daemon.
- One daemon per Smart Memory home.
- Stale pid/lock files can be recovered safely.
- A project-path mismatch skips an event rather than attaching it to the wrong project.

## Not In Phase 4

- Web UI.
- Cloud/team sync.
- Automatic official-memory promotion.
- Destructive raw-log cleanup.
- Agent-specific behavior hidden behind one untested adapter.

## Exit Criteria

Phase 4 is complete when daemon lifecycle is reliable, hooks remain non-blocking, repeated processing is idempotent, adapter event fixtures pass, and failures leave raw events recoverable for a later retry.
