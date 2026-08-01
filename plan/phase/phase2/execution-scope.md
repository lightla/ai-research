# Phase 2 Execution Scope

Date: 2026-08-02

## Focus

Phase 2 improves the local memory pipeline's usefulness for agents:

- stable ids for raw events, normalized transcript records, and memory records;
- exact lookup after search, without replaying or rescanning a full conversation in the agent context;
- clean default history output with `--verbose` and `--full` escape hatches;
- explicit separation between raw capture, offline classification, review candidates, and official memory.

The existing web application is not part of this phase.

## Daemon Decision

No persistent background process queue daemon in Phase 2.

The hook path should stay short-lived and reliable: append one normalized event and exit. Input/output hooks may launch a detached one-shot worker that runs `smem process`, but they do not wait for it. A persistent daemon is useful only after classifier thresholds, deduplication, retry behavior, SQLite locking, and candidate review rules are proven with real capture volume.

The daemon is a later runtime optimization, not a prerequisite for smarter retrieval or filtering.

## Exit Gate

Before starting a daemon phase, smem should have measured:

- how many captured events are discarded as noise;
- candidate acceptance and rejection rates;
- processing latency and queue size;
- duplicate and retry behavior;
- recovery behavior after an interrupted process run.
