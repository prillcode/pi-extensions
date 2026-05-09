# openspec pi extension

A pi extension that shells out to the local `openspec` CLI for common OpenSpec workflows.

## Repo / live locations
- Repo source of truth: `~/dev/pi-skills/pi-extensions/openspec/`
- Live pi extension: `~/.pi/agent/extensions/openspec/`
- Sync command:

```bash
~/dev/pi-skills/pi-extensions/sync-to-pi-agent.sh openspec
```

Then reload in pi with:

```text
/reload
```

## Prerequisite
Install the OpenSpec CLI:

```bash
npm install -g @fission-ai/openspec@latest
```

## What it provides

### Tool
- `openspec_cli`

Supported actions:
- `list_changes`
- `list_specs`
- `show`
- `validate`
- `status`
- `instructions`
- `new_change`

### Slash commands
- `/openspec-list [changes|specs]`
- `/openspec-show <name> [change|spec]`
- `/openspec-validate [--all|<name>] [change|spec]`
- `/openspec-status <change>`
- `/openspec-instructions <artifact> <change>`
- `/openspec-new-change <name> [description]`

## Notes
- The extension disables OpenSpec telemetry for spawned commands with `OPENSPEC_TELEMETRY=0`.
- It auto-detects `openspec/` in the current repo and adds lightweight OpenSpec context for the agent.
- This extension is intended to wrap the CLI, not replace native OpenSpec file structures.
