#!/usr/bin/env sh
set -eu

npm uninstall -g smart-memory

if [ -d "${SMEM_INSTALL_DIR:-"$HOME/.smem/src"}" ]; then
  rm -rf "${SMEM_INSTALL_DIR:-"$HOME/.smem/src"}"
fi

echo "smem uninstalled"
