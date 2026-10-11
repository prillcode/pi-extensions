#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${PI_NODE_MODULES:-}" ]]; then
  INSTALL="${PI_MANAGED_INSTALL_ROOT:-$HOME/.pi/agent/install}"
  IFS= read -r VERSION < "$INSTALL/current-version" || true
  PI_NODE_MODULES="$INSTALL/releases/$VERSION/node_modules"
fi
[[ -d "$PI_NODE_MODULES/@earendil-works/pi-coding-agent" ]] || { echo "Set PI_NODE_MODULES to Pi's installed node_modules" >&2; exit 1; }
CHECK=$(mktemp -d)
trap 'rm -rf "$CHECK"' EXIT
mkdir -p "$CHECK/dashboard" "$CHECK/agent"
rsync -a --exclude node_modules --exclude dist "$ROOT/" "$CHECK/dashboard/"
ln -s "$PI_NODE_MODULES" "$CHECK/dashboard/node_modules"
export PI_CODING_AGENT_DIR="$CHECK/agent"
cd "$CHECK/dashboard"
if [[ "${1:-}" == "--typecheck" ]]; then
  TSC="${TSC_BIN:-$(command -v tsc || true)}"
  [[ -f "$TSC" ]] || { echo "Set TSC_BIN to a TypeScript tsc executable" >&2; exit 1; }
  node "$TSC" --project tsconfig.json
elif [[ $# -gt 0 ]]; then
  echo "Usage: verify.sh [--typecheck]" >&2; exit 1
fi
"$PI_NODE_MODULES/.bin/jiti" tests/dashboard.test.ts
