# Decision: Provide One-Command Installer For smem

## Status

Approved for Phase 1.

## Context

Users expect CLI tools to install with one command, for example `npm install -g <package>` or `curl .../install.sh | sh`. Asking users to `cd` into the source folder and run a project script is acceptable for development, but not for a real tool.

## Decision

Provide an installer script:

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/<branch>/smem/install.sh | sh
```

The installer supports a custom Git source:

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/<branch>/smem/install.sh \
  | SMEM_REPO_URL=https://github.com/<owner>/<repo>.git SMEM_REF=<branch> sh
```

Local checkout install remains available:

```bash
sh ./install.sh
```

## Rationale

- One command is the expected CLI install UX.
- The script can work before npm publishing exists.
- npm global install still remains the final mechanism behind the script.
- The installer checks Node.js 24+ because `smem` uses `node:sqlite`.

## Future

When package publishing is ready, support:

```bash
npm install -g @smart-memory/smem
```

The curl installer can then become a thin wrapper around the npm package.
