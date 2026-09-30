# Maestro router extension

A Pi virtual model that routes each turn across model tiers by task difficulty. Tiers are
config-driven and can mix providers freely.

Select it as `router/maestro`. For every new user message it classifies the requested work with
TypeSafe's Jev (via the authenticated `openrouter` provider) and starts the turn on a tier:

| Tier | Default model | Then |
|---|---|---|
| routine | `opencode-go/deepseek-v4-flash` | stays on the workhorse |
| standard | `openai-codex/gpt-6-luna` | after the first successful `edit`/`write`, the rest of the turn drops to the workhorse tier |
| complex | `openai-codex/gpt-6-sol` | stays on the senior model for the whole turn |

Continuations and retries reuse the turn's tier so the provider prompt cache stays valid.
Compaction and other out-of-loop calls go to the workhorse. Short approval replies ("continue",
"go ahead") keep the previous turn's tier instead of reclassifying. If Jev is unreachable, a
keyword/length heuristic decides the tier.

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

- Credentials for whatever providers the configured tiers use (defaults: `opencode-go` and
  `openai-codex`).
- An authenticated `openrouter` credential for the Jev classifier
  (`openrouter/typesafe/jev-1.13`). Without it the extension falls back to the keyword heuristic.

Check the routed catalog with:

```bash
pi --list-models maestro
```

## Configuration

Everything lives at the top of `index.ts`. Tiers are `{ provider, id }` pairs, so you can point
each tier at any provider's model:

```ts
const TIERS: Record<TierName, TierModel> = {
  routine: { provider: "opencode-go", id: "deepseek-v4-flash" },
  standard: { provider: "openai-codex", id: "gpt-6-luna" },
  complex: { provider: "openai-codex", id: "gpt-6-sol" },
};
```

- `WORKHORSE` — the tier a standard turn hands off to after its first edit (default `routine`).
- `FALLBACK_ORDER` — which tiers to try when the preferred tier has no credentials. A missing
  provider key degrades to another tier instead of breaking the turn.
- `CLASSIFIER_CANDIDATES` — Jev candidates, first one present wins; set to `[]` to force the
  heuristic.
- `COMPLEX_HINTS` / `ROUTINE_HINTS` — keyword tables used when Jev is unavailable.
- `APPROVAL` — short replies that continue the previous turn's tier.
- `contextWindow` / `maxTokens` — declared on the virtual model; keep the context window at or
  below the smallest configured tier.

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
