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
- `/openspec-proposal <change> [--force]`
- `/openspec-design <change> [--force]`
- `/openspec-tasks <change> [--force]`
- `/openspec-draft-proposal <change> <doc...> [--force]`
- `/openspec-draft-design <change> <doc...> [--force]`

## Notes
- The extension disables OpenSpec telemetry for spawned commands with `OPENSPEC_TELEMETRY=0`.
- It auto-detects `openspec/` in the current repo and adds lightweight OpenSpec context for the agent.
- `/openspec-proposal`, `/openspec-design`, and `/openspec-tasks` scaffold files by extracting the `<template>` and `Write to:` path from `openspec instructions` output.
- `/openspec-draft-proposal` and `/openspec-draft-design` scaffold the file and then queue a Pi drafting prompt that uses the provided PRD-style docs as source input.
- If a target file already exists, the command asks before overwriting unless `--force` is used.
- This extension is intended to wrap the CLI, not replace native OpenSpec file structures.
