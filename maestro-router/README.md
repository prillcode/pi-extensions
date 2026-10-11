# Maestro router extension

A Pi virtual model that uses TypeSafe's Jev to classify each new task, then delegates execution to one of three named OmniRoute combos. Maestro selects the tier; OmniRoute selects a provider/model within that combo and owns execution fallback.

## Tier behavior (example snapshot)

> This table is a snapshot of one example setup, not the source of truth. Combo target order is stored in OmniRoute and edited there; this extension only references the combo names.

| Tier | OmniRoute combo | Ordered targets (priority) |
|---|---|---|
| routine | `omniroute/maestro-routine` | `opencode-go/deepseek-v4-flash` → `openrouter/deepseek/deepseek-v4-flash` → `cloudflare-ai/@cf/qwen/qwen2.5-coder-32b-instruct` |
| standard | `omniroute/maestro-standard` | `opencode-go/deepseek-v4-pro` → `openrouter/openai/gpt-6-luna` → `cloudflare-ai/@cf/moonshotai/kimi-k2.6` |
| complex | `omniroute/maestro-complex` | `opencode-go/kimi-k3` → `openrouter/openai/gpt-6.1-sol` → `openrouter/anthropic/claude-opus-5.5` |

The combos use OmniRoute's `priority` strategy. A standard turn hands implementation to the routine combo after its first successful `edit`/`write`; complex and routine turns stay in their selected tier. Retries stay on the same combo so OmniRoute can handle fallback. Compaction uses the routine combo. Short approval replies retain the previous branch's tier. If Jev is unavailable, a keyword/length heuristic chooses a tier.

The combo target order is operational configuration stored in OmniRoute, not in this extension. Provider availability and cost are tracked in OmniRoute; Pi's combo-level price estimate is not the source of truth.

## Prerequisites

- OmniRoute running at `http://127.0.0.1:20128` with the three combos above.
- `~/.pi/agent/models.json` defining provider `omniroute` and exposing those combo IDs. The local installation uses `~/.omniroute/pi.key` as its API key; never commit that key.
- An authenticated `openrouter` credential for Jev (`openrouter/typesafe/jev-1.13`). Without it the extension falls back to the keyword heuristic.

## Locations and sync

- Repo source: `~/dev/pi-extensions/maestro-router/`
- Live extension: `~/.pi/agent/extensions/maestro-router/`

Sync after changing the source:

```bash
~/dev/pi-extensions/sync-to-pi-agent.sh maestro-router
```

Then run `/reload` in Pi. Select the virtual model as `router/maestro` or start with:

```bash
pi --model router/maestro
```

## Configuration

Tier combo names are in `TIERS` at the top of `index.ts`. `WORKHORSE` controls the tier standard work hands off to. `CLASSIFIER_CANDIDATES` selects Jev candidates; `COMPLEX_HINTS`, `ROUTINE_HINTS`, and `APPROVAL` control the heuristic and approval handling.

Maestro intentionally has no cross-tier fallback: a missing combo or OmniRoute authentication error is reported, not silently routed to a different tier. Configure fallback targets inside each OmniRoute combo.

Check the routed catalog with:

```bash
pi --list-models maestro
```
