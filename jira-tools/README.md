# jira-tools pi extension

A pi-native Jira/Confluence extension for lightweight search, issue creation, progress logging, and sprint reports from inside pi.

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
- `jira_get_issue`
- `jira_add_comment`
- `jira_create_issue`
- `jira_close`
- `jira_generate_sprint_report`
- `/jira-status`
- `/jira-create`
- `/jira-search`
- `/jira-get-issue`
- `/jira-log`
- `/jira-close`
- `/jira-sprint-report`

## Default config
- Instance URL: `https://tylertech.atlassian.net`
- Cloud ID: `748898e2-ca0a-43b6-981b-09e249be204c`
- Default project key: `MDO`
- Story points field: `customfield_10059`
- Sprint field: `customfield_10020`
- Confluence space key: `MDO`

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

Optional combined-token fallback is also supported:

```json
{
  "PI_JIRA_ATLASSIAN_TOKEN": "email@example.com:api_token"
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

### `jira_get_issue`
Get a single Jira issue by key and return the normalized issue shape.

### `jira_add_comment`
Add a Jira comment to an issue using Atlassian document format.

### `jira_create_issue`
Create a Jira issue.

### `jira_close`
Add a closing comment and transition a Jira issue to `done` or `cancel`.

### `jira_generate_sprint_report`
Generate an MDO sprint report markdown file and optionally publish it to Confluence.

Parameters:
- `sprintNames`
- optional `outputDir`
- optional `publish`

Returns:
- `sprintNames`
- `filePath`
- `stats`
- optional `pageId`
- optional `pageUrl`
- optional `pageAction`

## Slash commands

### `/jira-status`
Show loaded Jira config/auth status.

### `/jira-create`
Interactive helper for explicit Jira issue creation.

### `/jira-search [optional jql]`
Interactive helper for explicit Jira search.

### `/jira-get-issue ISSUE-123`
Interactive helper for retrieving a single Jira issue.

### `/jira-log ISSUE-123 [optional guidance]`
Queue a prompt that asks pi to summarize the relevant recent session context into a concise Jira progress comment and then call `jira_add_comment`.

### `/jira-close ISSUE-123 [done|cancel]`
Interactive helper that adds a closing comment and transitions the issue.

### `/jira-sprint-report [comma,separated,sprints]`
Generate the sprint report directly in the extension.

Current flow:
1. provide or prompt for sprint names
2. enter output directory
3. choose whether to publish to Confluence
4. generate the markdown report
5. optionally create/update the Confluence page

Examples:
```text
/jira-sprint-report 2026.2.1
/jira-sprint-report 2026.2.1,2026.2.2
```

## Sprint report behavior
- JQL: `project = MDO AND sprint IN ("<SPRINT_NAMES>") AND status = Done ORDER BY assignee`
- groups issues by assignee
- sums story points from `customfield_10059`
- tracks issues without points separately
- writes `sprint-<SPRINT_NAMES>-report.md`
- publishes to Confluence page title `Sprint Report: <SPRINT_NAMES>` when requested

## Notes
- Search and issue operations use direct Jira REST.
- Sprint reports use direct Jira REST plus Confluence REST.
- Confluence publishing creates or updates an existing page with the same title in the `MDO` space.
- If you change `~/.pi/agent/jira-tools.json`, reload the extension with `/reload`.
