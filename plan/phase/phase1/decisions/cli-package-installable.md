# Decision: Package smem As An Installable CLI

## Status

Approved and implemented for Phase 1.

## Context

Phase 1 needs `smem` to be usable as a real command, not only as a TypeScript source script. The tool is a local memory CLI first, so users should be able to install it globally from the local package and call `smem` from any workspace.

## Decision

Package `smem` as a Node.js CLI package with:

```text
bin: smem -> dist/cli/index.js
build: tsc + copied SQL migrations
install: npm run install:global
uninstall: npm run uninstall:global
```

The CLI remains local-first and uses outsider storage by default. Installing the command does not create any project config file.

## Rationale

- A real `smem` command is required to test the MVP workflow naturally.
- Node package `bin` is the simplest and most common way to install a TypeScript-built CLI.
- The package still keeps core logic framework-free.
- Local global install is enough for Phase 1; npm publishing can be decided later.

## Verification

Verified locally:

```text
pnpm typecheck
pnpm test
pnpm build
npm run install:global
smem --version
SMEM_HOME=<tmp> smem init/store/context
```
