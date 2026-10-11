# Pi Dashboard

A keyboard-driven Pi TUI dashboard. The obsolete Brain panel and brain-sync integration have been removed.

## Installation and sync

**Source of truth:** `~/dev/pi-extensions/dashboard/`. **Live copy:** `~/.pi/agent/extensions/dashboard/`.
Edit the repo only, then copy it using:

```bash
~/dev/pi-extensions/sync-to-pi-agent.sh dashboard
```

The live extension is an rsync copy, **not a symlink**. Sync uses `--delete` so removed panels disappear from the live directory too. Do not edit the live copy.

Run `/reload` when Pi is idle. If commands or changes are still missing, use `/quit` and restart Pi (optionally `pi --continue`). A restart was required during this migration; the underlying reload issue has not been established. Herdr is not required or excluded.

## Commands and shortcuts

- `/dashboard` or **Ctrl+Alt+D** — actually opens the dashboard.
- `/task [text]` / `/todo [text]` — quick-add a task, or select a task to toggle completion.
- `/footer` — toggle usage/model/git/task footer.
- **Ctrl+Shift+T** — toggle the task widget.

These custom screens require Pi's interactive TUI, not RPC/print mode. **Ctrl+Shift+D is Pi's hard-wired debug-log key**, intercepted before extensions, so the dashboard uses Ctrl+Alt+D instead. A terminal without modified-key support may not distinguish it; `/dashboard` remains available.

## Tabs

| Key | Tab | Actions |
|---|---|---|
| 1 | Tasks | ↑/↓ select, Space/Enter toggle, A add, E edit, X delete (confirm), J/K move down/up, M menu |
| 2 | Sessions | S switch, B choose a session to bookmark/unbookmark, F filter, R refresh, M menu |
| 3 | Git | C checkout, N create branch, D delete (confirm; separate force confirmation), S stage, U unstage, R refresh, M menu |
| 4 | OmniRoute | R refresh, D connection details |
| 5 | Info | Session/model, usage, cost, context used/limit/percent (including unknown-after-compaction state) |

←/→ cycle tabs; **PgUp/PgDn** scroll long content and help; **?** help; **Q/Esc** close. Lines are clipped to terminal width and long panels use a height-bounded viewport. Edit/filter/confirmation dialogs nest as overlays and restore focus to the dashboard.

### Tasks

Tasks persist as `dashboard-todos` custom session entries on the active branch. They restore on session start/tree navigation and reset for a session without tasks. Every mutation updates the widget. Reordering affects the widget's first three tasks too.

### Sessions

Uses Pi 1.x `path`/`modified` metadata and the real current session file. Named sessions retain their names; unnamed sessions show a readable timestamp. F searches names, first-message previews, and paths; submit an empty filter to clear it.

Bookmarks are saved atomically in `<agent-dir>/dashboard-bookmarks.json` (normally `~/.pi/agent/dashboard-bookmarks.json`), outside the repo and shared across sessions. Bookmarked sessions sort first. Corrupt/unreadable bookmark state produces an error rather than being overwritten.

Session usage scanning is streamed asynchronously, four sessions at a time; unchanged-file stats are cached. Git subprocesses are async, lazy-loaded when their tab opens, time-limited, and use argument arrays rather than shell interpolation. Local branches containing slashes are supported.

Session switching closes the dashboard before replacing the session. From the keyboard shortcut, Pi only supplies event context, so use `/dashboard` or `/resume` for an in-place switch. The Sessions menu can also spawn a new terminal; `TERMINAL` must name a single executable/path (default `alacritty`), not a shell command with arguments.

### OmniRoute

Read-only metadata from `GET /api/combos` and `GET /api/providers`:

- Each `maestro-*` combo's exact ordered targets, strategy, computed context length, and weights (including zero).
- Stored provider test status and enabled/disabled state; D reveals connection name, priority, backoff, last-tested time, and target context when supplied.
- Refreshes on tab entry and every **30 seconds while that tab is active**. Requests are single-flight, time-limited, and cancelled on tab exit; timers stop on close/reload/shutdown.
- Failed refreshes retain last good data, clearly labelled stale; R retries. No provider tests, model calls, or configuration changes are performed.

Default gateway: `http://127.0.0.1:20128`. Manage key: `~/.omniroute/pi.key` (mode 600). Overrides: `OMNIROUTE_BASE_URL` and `OMNIROUTE_MANAGE_KEY`. Non-local gateways require HTTPS; redirects are rejected. The key is never logged/rendered, and raw provider credentials/settings are discarded before data reaches the UI.

The array order is authoritative; descriptions can drift and are deliberately not shown. Provider status is the last stored connection test, **not live model health or the target actually selected for a request**. Combo context is not a guarantee of every fallback target's context. Missing target context is shown as unknown, not guessed.

## Development verification

```bash
# Uses the installed Pi release's dependencies in an isolated temporary copy.
bash dashboard/verify.sh

# Include strict TypeScript checks (point TSC_BIN at your installed TypeScript).
TSC_BIN=/path/to/typescript/bin/tsc bash dashboard/verify.sh --typecheck

# Optional read-only fetch of your running local OmniRoute gateway.
DASHBOARD_LIVE_TEST=1 bash dashboard/verify.sh

# Actual Pi TUI exercise, ephemeral session; requires the local gateway/models.
python3 dashboard/tests/tui-smoke.py
DASHBOARD_SMOKE_MODE=regular python3 dashboard/tests/tui-smoke.py
DASHBOARD_SMOKE_DISCOVERY=1 python3 dashboard/tests/tui-smoke.py
```

Override `PI_NODE_MODULES` for a nonstandard Pi installation. Tests cover task mutation/persistence, bookmarks, filtering/current-session metadata, async git/path safety, unknown context values, narrow/short rendering, OmniRoute credential redaction/poll cleanup, and command/shortcut registration.

## Structure

- `index.ts` — commands, shortcuts, session state/widget/footer, cleanup
- `components/Dashboard.ts` — tabs, tasks, Info, scrolling
- `components/GitPanel.ts` / `SessionPanel.ts` / `OmniRoutePanel.ts`
- `utils/` — git/session clients, bookmarks, management metadata, overlay dialogs, formatting
- `tests/dashboard.test.ts` — regression suite

Foundation, Git, Sessions, and this polish batch are implemented. Brain/brain-sync support is retired; no Brain repo or skill is used.
