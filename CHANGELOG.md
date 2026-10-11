# Changelog

## Unreleased

### Dashboard
- Remove retired Brain/brain-sync panel and renumber tabs to Tasks, Sessions, Git, OmniRoute, Info.
- Make Ctrl+Alt+D open the dashboard; add task selection, edit/delete/reorder with persistent widget updates.
- Fix Pi 1.x session metadata, named/current sessions, persistent bookmarks, and filtering.
- Replace synchronous git/session I/O with lazy async git and bounded streamed usage scans; preserve slash branches and safely pass file/branch arguments.
- Add live OmniRoute combo composition, weights, stored provider status/details, scoped 30s polling, stale/error states, cancellation, and credential allowlisting.
- Fix context-window/unknown-token reporting and million-token formatting; constrain width/height with scrolling and safe nested dialog overlays.
- Replace the dashboard live symlink with an rsync copy; reject symlink destinations in the sync helper.
- Add isolated regression tests and strict TypeScript verification.
