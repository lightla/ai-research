#!/usr/bin/env sh
set -eu

REPO_URL="${SMEM_REPO_URL:-}"
REF="${SMEM_REF:-main}"
INSTALL_DIR="${SMEM_INSTALL_DIR:-"$HOME/.smem/src"}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "smem installer: missing required command: $1" >&2
    exit 1
  fi
}

need node
need npm

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "smem installer: Node.js 24+ is required, found $(node --version)" >&2
  exit 1
fi

if [ -n "$REPO_URL" ]; then
  need git
  rm -rf "$INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 --branch "$REF" "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR/smem" 2>/dev/null || cd "$INSTALL_DIR"
else
  SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
  cd "$SCRIPT_DIR"
fi

if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile
  pnpm build
elif command -v corepack >/dev/null 2>&1; then
  corepack enable
  corepack pnpm install --frozen-lockfile
  corepack pnpm build
else
  npm install
  npm run build
fi

npm install -g . --ignore-scripts

echo "smem installed: $(command -v smem)"
smem --version
