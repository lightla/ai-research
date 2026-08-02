# smem

Smart Memory CLI core MVP.

## Scope

This package is the local Smart Memory core, not an MCP server. MCP can be added later as an interface over this core.

Phase 1 supports:

- outsider project registry
- SQLite memory store
- local and global memory scopes
- `guide`, `install`
- offline `classify`
- `process`, `candidates`, `promote`, `reject`
- `init`, `status`, `attach`, `move`, `del`, `list-projects`
- `store`, `list`, `recall`, `context`
- read-only Markdown render
- `web`: launch a local webapp to browse, search, edit, archive, and delete memories
  - `-d, --daemon`: run in the background and return the terminal; `--stop` / `--status` manage it

`recall` supports multiple modes:

- `--mode contains`: exact substring search
- `--mode fts`: SQLite lexical full-text search
- `--mode semantic`: vector search over indexed embeddings
- `--mode hybrid`: FTS + vector merge

Semantic/hybrid search requires `smem index` first.

It does not write any Smart Memory config into the target repo by default. Storage is external under `~/.smart-memory`, or under `SMEM_HOME` when set.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Run the CLI from source:

```bash
pnpm exec tsx src/cli/index.ts init
pnpm exec tsx src/cli/index.ts guide
pnpm exec tsx src/cli/index.ts install --agent codex --hooks
pnpm exec tsx src/cli/index.ts list-projects
pnpm exec tsx src/cli/index.ts move --project-id proj_...
pnpm exec tsx src/cli/index.ts move --from-path /old/project/path
pnpm exec tsx src/cli/index.ts del --project-id proj_accidental
pnpm exec tsx src/cli/index.ts classify "chốt dùng SQLite cho database storage"
pnpm exec tsx src/cli/index.ts process
pnpm exec tsx src/cli/index.ts candidates
pnpm exec tsx src/cli/index.ts store --type decision --title "Outsider store" --tags storage,mvp "Default storage does not write files into company repos."
pnpm exec tsx src/cli/index.ts store --scope global --type preference --title "Commit style" "Use conventional commits."
pnpm exec tsx src/cli/index.ts context
```

Run the built CLI:

```bash
pnpm build
node dist/cli/index.js status
```

Install it as a local global CLI:

```bash
npm run install:global
smem --version
```

Install with the installer script from this checkout:

```bash
sh ./install.sh
```

Once this repo is hosted, the script can be used in curl form:

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/<branch>/smem/install.sh | sh
```

For a custom hosted source:

```bash
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/<branch>/smem/install.sh \
  | SMEM_REPO_URL=https://github.com/<owner>/<repo>.git SMEM_REF=<branch> sh
```

Remove the global CLI:

```bash
npm run uninstall:global
```

Or:

```bash
sh ./uninstall.sh
```

Use a temporary store while testing:

```bash
SMEM_HOME=/tmp/smem-dev pnpm exec tsx src/cli/index.ts init
```
