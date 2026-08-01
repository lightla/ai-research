# Phase 4 Operations

## Queue Diagnostics

Inspect raw queue volume without reading the content into an agent context:

```bash
smem events stats
smem daemon status
```

The stats command reports bytes, event count, agent/kind counts, and timestamp bounds. It never deletes or rewrites the queue.

## systemd Example

Run the daemon from the project directory with a user service. Replace the paths for the local machine:

```ini
[Unit]
Description=smem offline memory processor

[Service]
WorkingDirectory=/home/light/workspace/project
ExecStart=/usr/local/bin/smem daemon run --interval 1000
Restart=on-failure

[Install]
WantedBy=default.target
```

The daemon is intentionally foreground-friendly so the service manager owns restart and logs.

## Retention

Phase 4 does not delete raw captures automatically. Retention needs an explicit policy for auditability, transcript references, and recovery. The manual archive command provides a recoverable rotation path:

```bash
smem events archive --older-than 30
smem events archive --older-than 30 --apply
```

The first command is preview-only. The second moves matching JSONL records to `events/archive/` and keeps invalid lines in the active queue for recovery.
