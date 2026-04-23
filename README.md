# pi-extensions

This directory is the editable source of truth for local pi extensions.

## Workflow

Develop extensions here:
- `~/dev/pi-skills/pi-extensions/<extension-name>/`

Sync an extension into pi's live auto-discovery directory for testing:
- `~/.pi/agent/extensions/<extension-name>/`

Use the helper script:

```bash
~/dev/pi-skills/pi-extensions/sync-to-pi-agent.sh <extension-name>
```

Example:

```bash
~/dev/pi-skills/pi-extensions/sync-to-pi-agent.sh jira-tools
```

Sync all extensions:

```bash
~/dev/pi-skills/pi-extensions/sync-to-pi-agent.sh --all
```

Then in pi, reload extensions:

```text
/reload
```

## Notes

- Treat this repo directory as the primary editable copy.
- Treat `~/.pi/agent/extensions/` as the live/testing copy for pi.
- The sync script uses `rsync --delete`, so the destination copy mirrors the repo copy.
- Excludes:
  - `node_modules`
  - `dist`
  - `.DS_Store`
