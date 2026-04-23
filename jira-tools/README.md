# jira-tools pi extension

A pi-native Jira extension for lightweight search, issue creation, and progress logging from inside pi.

## Repo / live locations
- Repo source of truth: `~/dev/pi-skills/pi-extensions/jira-tools/`
- Live pi extension: `~/.pi/agent/extensions/jira-tools/`
- Sync command:

```bash
~/dev/pi-skills/pi-extensions/sync-to-pi-agent.sh jira-tools
```

Then reload in pi with:

```text
/reload
```

## Current status
Implemented and working:
- `jira_search_issues`
- `jira_add_comment`
- `jira_create_issue` (first pass)
- `jira_close` (first pass)
- `/jira-status`
- `/jira-create`
- `/jira-search`
- `/jira-log`
- `/jira-close`

## Default config
- Instance URL: `https://tylertech.atlassian.net`
- Cloud ID: `748898e2-ca0a-43b6-981b-09e249be204c`
- Default project key: `MDO`
- Story points field: `customfield_10059`
- Sprint field: `customfield_10020`

## Local auth/config
Current working auth path is basic auth via either env vars or `~/.pi/agent/jira-tools.json`.

Example `~/.pi/agent/jira-tools.json`:

```json
{
  "email": "aaron.prill@tylertech.com",
  "apiToken": "YOUR_JIRA_API_TOKEN",
  "instanceUrl": "https://tylertech.atlassian.net",
  "cloudId": "748898e2-ca0a-43b6-981b-09e249be204c",
  "defaultProjectKey": "MDO"
}
```

Lock down the local config file with:

```bash
chmod 600 ~/.pi/agent/jira-tools.json
```

Config precedence:
1. `PI_JIRA_*` env vars
2. `~/.pi/agent/jira-tools.json`
3. built-in defaults

Use `/jira-status` in pi to verify config source and auth readiness.

## Tools

### `jira_search_issues`
Search Jira using JQL and return normalized issue fields.

Required returned fields:
- `summary`
- `assignee`
- `status`
- `customfield_10059`
- `issuetype`
- `customfield_10020`

Normalized issue output includes:
- `key`
- `summary`
- `status`
- `assigneeDisplayName`
- `assigneeEmail`
- `storyPoints`
- `issueType`
- `sprints`
- `url`

### `jira_add_comment`
Add a Jira comment to an issue using Atlassian document format.

Returns:
- `issueKey`
- `commentId`
- `url`

### `jira_create_issue`
Create a Jira issue.

First-pass supported fields:
- `summary`
- `description`
- `issueType`
- optional `projectKey`
- optional `parentKey`
- optional `labels`
- optional `assigneeAccountId`
- optional `storyPoints`

Returns:
- `key`
- `url`

### `jira_close`
Add a closing comment and transition a Jira issue to `done` or `cancel`.

First-pass supported fields:
- `issueKey`
- `resolution` (`done` or `cancel`)
- `comment`
- optional `transitionName` override

Returns:
- `issueKey`
- `resolution`
- `transitionName`
- `commentId`
- `url`

Notes:
- transition names are matched from available Jira transitions for the issue
- if no match is found, the tool fails and lists available transitions

## Slash commands

### `/jira-status`
Show loaded Jira config/auth status.

### `/jira-create`
Interactive helper for explicit Jira issue creation.

Current flow:
1. select issue type (`Task`, `Story`, `Bug`)
2. enter summary
3. enter description
4. create issue directly

Example:
```text
/jira-create
```

Or prefill the summary:
```text
/jira-create CS: AgentCore Debugging and Fixing Errors
```

### `/jira-search [optional jql]`
Interactive helper for explicit Jira search.

Current flow:
1. enter or edit JQL
2. enter max results
3. queue a prompt that explicitly invokes `jira_search_issues`

Examples:
```text
/jira-search
/jira-search project = MDO ORDER BY updated DESC
```

### `/jira-log ISSUE-123 [optional guidance]`
Queue a prompt that asks pi to summarize the relevant recent session context into a concise Jira progress comment and then call `jira_add_comment`.

Current flow:
1. provide or prompt for issue key
2. select comment intent
3. optionally add extra guidance
4. queue a prompt that drafts a concise session-grounded comment and posts it

Examples:
```text
/jira-log MDO-719
/jira-log MDO-719 focus on the root cause and deployed fix only
```

### `/jira-close ISSUE-123 [done|cancel]`
Interactive helper that adds a closing comment and transitions the issue.

Current flow:
1. provide or prompt for issue key
2. provide or select closing resolution (`done` or `cancel`)
3. choose comment mode:
   - `Manual`
   - `AI concise summary`
4. for manual mode, edit a closing comment directly
5. for AI mode, select summary focus and optionally add extra guidance
6. close the issue

Examples:
```text
/jira-close MDO-719 done
/jira-close MDO-719 cancel
```

## Working examples

### Natural-language search
Prompt:
```text
Show me the 5 most recently updated Jira issues in MDO.
```

Equivalent JQL used by the tool:
```jql
project = MDO ORDER BY updated DESC
```

### Add progress comment
Prompt:
```text
Add a Jira comment to MDO-695 that says:
Test comment from pi jira-tools extension on 2026-04-22.
```

Observed tool-backed result shape:
```text
Added Jira comment to MDO-695.
commentId: 11617939
url: https://tylertech.atlassian.net/browse/MDO-695?focusedCommentId=11617939
```

### Create a concise task from session context
Prompt:
```text
Create a Jira Task in MDO with summary "CS: AgentCore Debugging and Fixing Errors" and description that is very concise relevant to this task. We will add a jira comment after with the full context above.
```

Observed tool-backed result shape:
```text
Created Jira Task: MDO-719
summary: CS: AgentCore Debugging and Fixing Errors
url: https://tylertech.atlassian.net/browse/MDO-719
```

Resulting concise description example:
```text
Investigate recent AgentCore/agent-api failures, identify root cause, and implement fixes/guardrails to prevent recurring runtime errors.
```

## Notes
- Search is read-first and stable enough for normal use.
- `jira_add_comment` is useful for logging progress directly from pi.
- `jira_create_issue` is intentionally first-pass and may still hit Jira project/screen-specific constraints for certain optional fields.
- If you change `~/.pi/agent/jira-tools.json`, reload the extension with `/reload`.
