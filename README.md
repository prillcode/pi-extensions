# pi-extensions

This directory is the editable source of truth for local pi extensions.

## Workflow

Develop extensions here:
- `~/dev/pi-extensions/<extension-name>/`

Sync an extension into pi's live auto-discovery directory for testing:
- `~/.pi/agent/extensions/<extension-name>/`

Use the helper script:

```bash
~/dev/pi-extensions/sync-to-pi-agent.sh <extension-name>
```

Example:

```bash
~/dev/pi-extensions/sync-to-pi-agent.sh jira-tools
```

Sync all extensions:

```bash
~/dev/pi-extensions/sync-to-pi-agent.sh --all
```

Then in pi, reload extensions:

```text
/reload
```

## Notes

- Treat this repo directory as the primary editable copy.
- Treat `~/.pi/agent/extensions/` as the live/testing copy for pi.
- Live extension directories are real rsync copies, not symlinks. The sync helper rejects a symlink destination to avoid accidentally syncing the source onto itself.
- The sync script uses `rsync --delete`, so the destination copy mirrors the repo copy.
- If `/reload` leaves a command/change missing, `/quit` and restart Pi; the reload failure observed during migration has not been diagnosed.
- Excludes:
  - `node_modules`
  - `dist`
  - `.DS_Store`
  - `docs`
