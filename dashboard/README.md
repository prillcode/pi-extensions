# Pi Dashboard Extension

A TUI dashboard extension for pi with integrated workflows.

## Features

- **Dashboard** (`/dashboard`) - Multi-tab dashboard with session stats, git integration, and session management
- **Todo Management** (`/todo`) - Persistent todo list with widget
- **Git Integration** - Full git panel with status, commits, branch management, and file operations
- **Session Management** - List, switch between, and bookmark pi sessions
- **Custom Footer** - Session stats and context

## Tabs

1. **Overview** - Session info, model details, todo summary
2. **Todos** - Full todo management
3. **Stats** - Token usage, cost tracking, context window
4. **Git** - Repository status, commits, branches, file staging
5. **Sessions** - Session list, quick switching, stats

## Installation

```bash
# From the pi-skills repo
ln -s "$(pwd)/extensions/dashboard" ~/.pi/agent/extensions/dashboard
```

## Commands

- `/dashboard` - Open the dashboard
- `/todo [text]` - Add or manage todos
- `/footer` - Toggle custom footer

## Shortcuts

- `Ctrl+Shift+D` - Quick dashboard shortcut

## Git Tab Actions (when on Git tab)

- `C` - Checkout branch
- `N` - Create new branch
- `D` - Delete branch (with confirmation)
- `S` - Stage file
- `U` - Unstage file

## Sessions Tab Actions (when on Sessions tab)

- `S` - Switch to session
- `B` - Toggle bookmark (coming soon)

## Architecture

```
dashboard/
├── index.ts              # Main extension entry
├── types.ts              # Shared types
├── components/
│   ├── Dashboard.ts      # Main dashboard component
│   ├── GitPanel.ts       # Git integration UI
│   └── SessionPanel.ts   # Session management UI
├── utils/
│   ├── git.ts            # Git command wrappers
│   └── sessions.ts       # Session management utilities
└── README.md
```

## Development Status

- **Phase 01** ✅ Foundation - Basic dashboard with Overview, Todos, Stats tabs
- **Phase 02** ✅ Git Integration - Git panel with status, commits, branches, file operations
- **Phase 03** ✅ Session Management - Session switcher and stats
- **Phase 04** ⏳ Polish - Enhanced tabs, shortcuts, styling (optional)

## Phase 02: Git Integration Details

**Standard Scope - Implemented:**
- Repository status (branch, ahead/behind, modified/staged/untracked counts)
- Recent commits (last 5)
- Local branches list (up to 8)
- Branch operations: checkout, create, delete (with confirmation)
- File operations: stage, unstage

## Phase 03: Session Management Details

**Implemented:**
- List all pi sessions with stats
- Current session highlighted
- Quick session switching via SelectList
- Token usage and cost per session
- Relative timestamps (2h ago, 3d ago)

**Pending:**
- Bookmark persistence
- Session search/filter
