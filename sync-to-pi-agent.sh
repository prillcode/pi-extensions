#!/usr/bin/env bash
set -euo pipefail

SRC_BASE="$HOME/dev/pi-skills/pi-extensions"
DEST_BASE="$HOME/.pi/agent/extensions"

usage() {
  cat <<EOF
Usage:
  $(basename "$0") <extension-name>
  $(basename "$0") --all

Examples:
  $(basename "$0") jira-tools
  $(basename "$0") --all

Copies extension source from:
  $SRC_BASE/<extension-name>
into:
  $DEST_BASE/<extension-name>

This keeps your pi-skills repo as the editable source of truth and syncs it into
pi's live auto-discovery extension directory for testing.
EOF
}

sync_one() {
  local ext="$1"
  local src="$SRC_BASE/$ext/"
  local dest="$DEST_BASE/$ext/"

  if [[ ! -d "$src" ]]; then
    echo "Source extension not found: $src" >&2
    exit 1
  fi

  mkdir -p "$dest"
  rsync -av --delete \
    --exclude node_modules \
    --exclude .DS_Store \
    --exclude dist \
    "$src" "$dest"

  echo "Synced $ext -> $dest"
}

main() {
  if [[ $# -ne 1 ]]; then
    usage
    exit 1
  fi

  case "$1" in
    --all)
      shopt -s nullglob
      local found=0
      for dir in "$SRC_BASE"/*; do
        [[ -d "$dir" ]] || continue
        found=1
        sync_one "$(basename "$dir")"
      done
      if [[ $found -eq 0 ]]; then
        echo "No extensions found under $SRC_BASE" >&2
        exit 1
      fi
      ;;
    -h|--help)
      usage
      ;;
    *)
      sync_one "$1"
      ;;
  esac
}

main "$@"
