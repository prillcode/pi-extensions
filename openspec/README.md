# OpenSpec Pi extension

Pi extension for working with [OpenSpec](https://openspec.dev) from inside Pi.

It wraps the local `openspec` CLI, adds OpenSpec-aware slash commands, scaffolds proposal/design/tasks files from `openspec instructions`, and can queue drafting prompts from PRD-style source documents.

## Locations

- Repo source of truth: `~/dev/pi-skills/pi-extensions/openspec/`
- Live Pi extension: `~/.pi/agent/extensions/openspec/`

Sync to the live Pi extensions directory:

```bash
~/dev/pi-skills/pi-extensions/sync-to-pi-agent.sh openspec
```

Then reload Pi:

```text
/reload
```

## Prerequisite

Install the OpenSpec CLI:

```bash
npm install -g @fission-ai/openspec@latest
```

## What this extension does

### 1. OpenSpec CLI wrapper tool
Registers the Pi tool:

- `openspec_cli`

Supported actions:
- `list_changes`
- `list_specs`
- `show`
- `validate`
- `status`
- `instructions`
- `new_change`

### 2. OpenSpec-aware slash commands
#### General
- `/osp-list [changes|specs]`
- `/osp-show <name> [change|spec]`
- `/osp-validate [--all|<name>] [change|spec]`
- `/osp-status [change]`
- `/osp-instructions <artifact> [change]`
- `/osp-new-change <name> [description]`

#### Scaffolding from OpenSpec templates
- `/osp-proposal [change] [--force]`
- `/osp-design [change] [--force]`
- `/osp-tasks [change] [--force]`
- `/osp-spec-deltas [change] [--force]`

#### Drafting from PRD-style source docs
- `/osp-draft-proposal [change] <doc...> [--force]`
- `/osp-draft-design [change] <doc...> [--force]`
- `/osp-draft-tasks [change] <doc...> [--force]`

## Active change convenience

If the repo has exactly **one active OpenSpec change**, the commands that need a change name can omit it.

Example:

```text
/osp-design
/osp-status
/osp-draft-design docs/prd.md
```

If there are multiple active changes, pass the change name explicitly.

## Typical workflow

### Create a change
```text
/osp-new-change add-sso "Add SSO support"
```

### Scaffold core artifacts
```text
/osp-proposal add-sso
/osp-design add-sso
/osp-tasks add-sso
```

### Or draft them from a PRD
```text
/osp-draft-proposal add-sso docs/sso-prd.md
/osp-draft-design add-sso docs/sso-prd.md
/osp-draft-tasks add-sso docs/sso-prd.md
```

### Scaffold spec delta files from proposal capabilities
After you fill in the `Capabilities` section of `proposal.md`:

```text
/osp-spec-deltas add-sso
```

This creates change-scoped spec files under:

```text
openspec/changes/<change>/specs/<capability>/spec.md
```

### Validate
```text
/osp-validate add-sso change
/osp-validate --all
```

## Drafting behavior

The `draft-*` commands do two things:

1. scaffold the target file from `openspec instructions`
2. queue a Pi prompt telling the agent to draft the file using the provided PRD-style docs

That means OpenSpec still provides the structure and expected artifact flow, while Pi helps author the actual content.

## Scaffolding behavior

### Proposal / design / tasks
The scaffolding commands extract:
- the `Write to:` path
- the `<template>` block

from `openspec instructions` output and write the artifact file for you.

### Spec deltas
`/osp-spec-deltas` reads `proposal.md`, parses the `New Capabilities` and `Modified Capabilities` bullet lists, and creates simple starter `spec.md` files for each listed capability.

To work well, use concrete bullets such as:

```md
### New Capabilities
- user-auth: Authentication and login behavior for app users

### Modified Capabilities
- org-catalog: Add SSO-related org metadata
```

## Overwrite behavior

If a target file already exists:
- interactive Pi sessions ask before overwriting
- `--force` overwrites immediately

## Notes

- The extension disables OpenSpec telemetry for spawned commands with `OPENSPEC_TELEMETRY=0`.
- It auto-detects `openspec/` in the current repo and injects lightweight OpenSpec context for the agent.
- This extension is meant to improve day-to-day authoring ergonomics around OpenSpec, not replace OpenSpec’s file structure or validation model.
