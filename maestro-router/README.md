# Maestro router extension

A Pi virtual model that routes each turn across the OpenAI Codex tiers by task difficulty.

Select it as `router/maestro`. For every new user message it classifies the requested work with
TypeSafe's Jev (via the authenticated `openrouter` provider) and starts the turn on a tier:

| Classification | Starting model | Then |
|---|---|---|
| routine | `gpt-5.6-luna` | stays Luna |
| standard | `gpt-5.6-terra` | after the first successful `edit`/`write`, the rest of the turn drops to Luna |
| complex | `gpt-5.6-sol` | stays Sol for the whole turn |

Continuations and retries reuse the turn's model so the provider prompt cache stays valid.
Compaction and other out-of-loop calls go to Luna. Short approval replies ("continue", "go ahead")
keep the previous turn's tier instead of reclassifying. If Jev is unreachable, a keyword/length
heuristic decides the tier.

## Locations

- Repo source of truth: `~/dev/pi-skills/pi-extensions/maestro-router/`
- Live Pi extension: `~/.pi/agent/extensions/maestro-router/`

Sync to the live Pi extensions directory:

```bash
~/dev/pi-skills/pi-extensions/sync-to-pi-agent.sh maestro-router
```

Then reload Pi:

```text
/reload
```

## Prerequisites

- An authenticated OpenAI Codex login (the three routed models live on the `openai-codex` provider).
- An authenticated `openrouter` credential for the Jev classifier
  (`openrouter/typesafe/jev-1.13`). Without it the extension falls back to the heuristic.

Check the routed catalog with:

```bash
pi --list-models maestro
```

## Usage

Select the model in Pi:

```text
/model
```

Choose **Maestro**, or start Pi directly with:

```bash
pi --model router/maestro
```

Press `Ctrl+S` in the model picker to save it as the default for new sessions.

## Tuning

The constants at the top of `index.ts` control behavior:

- `CLASSIFIER_CANDIDATES` — Jev candidates, first one present wins; set to `[]` to force the heuristic.
- `COMPLEX_HINTS` / `ROUTINE_HINTS` — keyword tables used by the fallback.
- `APPROVAL` — short replies that continue the previous turn's tier.
- `TIERS`, `EDIT_TOOLS`, provider/model ids.
