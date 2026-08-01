# Phase 4 Backlog

## P0: Queue Runtime

- [x] Add `daemon once` for one offline processing batch.
- [x] Add `daemon run --interval` with one-home lock.
- [x] Add `daemon status` and `daemon stop`.
- [x] Ensure stale pid/lock recovery and idempotent processing.

## P1: Hook Automation

- [x] Keep hook append path bounded and non-blocking.
- [x] Add daemon trigger guidance for installed agents.
- [x] Add event signal counters and processing diagnostics.
- [ ] Add Claude Code/Codex/Antigravity hook lifecycle fixtures.

## P2: Operations

- [x] Add configurable retention policy without deleting raw by default.
- [x] Add service-manager examples for WSL/Linux.
- [x] Add crash/restart and concurrent-hook stress tests.
- [ ] Measure queue latency and candidate acceptance rate.

## Risks

- A daemon can hide failures if diagnostics are not visible.
- Multiple processes can contend on SQLite without a single-home lock.
- Processing too aggressively can create review noise; promotion must remain explicit.
