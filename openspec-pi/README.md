# OpenSpec Pi extension

Pi extension for working with [OpenSpec](https://openspec.dev) from inside Pi.

It wraps the local `openspec` CLI, adds short `osp-*` slash commands, scaffolds OpenSpec artifacts from `openspec instructions`, drafts files from PRD-style docs, and helps complete the full OpenSpec lifecycle inside Pi.

## Locations

- Repo source of truth: `~/dev/pi-skills/pi-extensions/openspec-pi/`
- Live Pi extension: `~/.pi/agent/extensions/openspec-pi/`

Sync to the live Pi extensions directory:

```bash
~/dev/pi-skills/pi-extensions/sync-to-pi-agent.sh openspec-pi
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

## What this extension provides

### Tool
- `openspec_cli`

Supported actions:
- `init`
- `update`
- `archive`
- `list_changes`
- `list_specs`
- `show`
- `validate`
- `status`
- `instructions`
- `new_change`

### Slash commands
#### Help / setup / maintenance
- `/osp-help`
- `/osp-init`
- `/osp-update`

#### General OpenSpec workflow
- `/osp-list [changes|specs]`
- `/osp-show <name> [change|spec]`
- `/osp-status [change]`
- `/osp-validate [--all|<name>] [change|spec]`
- `/osp-instructions <artifact> [change]`
- `/osp-new-change <name> [description]`
- `/osp-archive [change] [--skip-specs] [--no-validate]`

#### Scaffolding
- `/osp-proposal [change] [--force]`
- `/osp-design [change] [--force]`
- `/osp-tasks [change] [--force]`
- `/osp-spec-deltas [change] [--force]`

#### Drafting from PRD-style docs
- `/osp-draft-proposal [change] <doc...> [--force]`
- `/osp-draft-design [change] <doc...> [--force]`
- `/osp-draft-tasks [change] <doc...> [--force]`

## Active change convenience

If the repo has exactly **one active OpenSpec change**, commands that need a change name can omit it.

Examples:

```text
/osp-status
/osp-design
/osp-draft-design docs/prd.md
/osp-spec-deltas
```

If multiple active changes exist, pass the change explicitly.

## Typical workflow

### 1. Initialize OpenSpec in a repo
```text
/osp-init
```

This runs OpenSpec init with Pi-friendly defaults:
- path: `.`
- tool profile: `pi`
- auto cleanup: `--force`

### 2. Create a change
```text
/osp-new-change add-sso "Add SSO support"
```

### 3. Draft proposal / design / tasks from a PRD
```text
/osp-draft-proposal add-sso docs/sso-prd.md
/osp-draft-design add-sso docs/sso-prd.md
/osp-draft-tasks add-sso docs/sso-prd.md
```

### 4. Scaffold spec delta files from proposal capabilities
After filling in the `Capabilities` section of `proposal.md`:

```text
/osp-spec-deltas add-sso
```

### 5. Validate
```text
/osp-validate add-sso change
/osp-validate --all
```

### 6. Archive when complete
```text
/osp-archive add-sso
```

## Drafting behavior

The draft commands do two things:

1. scaffold the target file from `openspec instructions`
2. queue a Pi drafting prompt that uses your PRD-style docs as source input

This keeps OpenSpec in charge of structure and artifact flow while Pi helps author the content.

If Pi is already busy when a draft command runs, the drafting prompt is queued as a **follow-up** instead of being injected immediately.

## Validation / safety behavior

### Source doc validation
The draft commands validate source doc paths before queueing a drafting prompt.

If a file is missing or is not a file, the command fails fast with a clear message.

### Overwrite behavior
If a target artifact already exists:
- interactive Pi sessions ask before overwriting
- `--force` overwrites immediately

## Spec delta scaffolding

`/osp-spec-deltas` reads `proposal.md`, parses the `New Capabilities` and `Modified Capabilities` bullet lists, and creates starter change-scoped spec files under:

```text
openspec/changes/<change>/specs/<capability>/spec.md
```

Use concrete capability bullets such as:

```md
### New Capabilities
- user-auth: Authentication and login behavior for app users

### Modified Capabilities
- org-catalog: Add SSO-related org metadata
```

## Archived change support

If you use `/osp-show` with an archived change name, the extension falls back to reading the archived change files directly and displays the archived proposal/design/tasks content.

## Notes

- The extension disables OpenSpec telemetry for spawned commands with `OPENSPEC_TELEMETRY=0`.
- It auto-detects `openspec/` in the current repo and injects lightweight OpenSpec context for the agent.
- The command names are intentionally short (`osp-*`) for faster use inside Pi.
- This extension is meant to improve day-to-day authoring ergonomics around OpenSpec, not replace OpenSpec’s file structure or validation model.
