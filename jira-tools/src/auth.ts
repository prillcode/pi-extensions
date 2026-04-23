import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { getJiraConfig } from './config.js';
import type { JiraAuthState } from './types.js';

export function getClaudeCredentialsPath(): string {
  return join(homedir(), '.claude', '.credentials.json');
}

export function detectJiraAuthState(): JiraAuthState {
  const claudeCredentialsPath = getClaudeCredentialsPath();
  const config = getJiraConfig();

  if (config.apiToken) {
    return {
      mode: 'basic-auth-ready',
      source: config.configSource === 'env' ? 'PI_JIRA_EMAIL + PI_JIRA_API_TOKEN' : config.configPath,
      details: `Basic auth is configured for ${config.email} via ${config.configSource}.`,
    };
  }

  if (existsSync(claudeCredentialsPath)) {
    return {
      mode: 'oauth-reuse-candidate',
      source: claudeCredentialsPath,
      details:
        'Claude Atlassian credentials were found, but direct Jira REST reuse was not validated. Set PI_JIRA_API_TOKEN or ~/.pi/agent/jira-tools.json for the working read path.',
    };
  }

  return {
    mode: 'unconfigured',
    details: 'Set PI_JIRA_EMAIL and PI_JIRA_API_TOKEN or create ~/.pi/agent/jira-tools.json to enable Jira REST search.',
  };
}

export async function getJiraBasicAuthHeader(): Promise<string> {
  const config = getJiraConfig();
  const jiraApiToken = config.apiToken;

  if (!jiraApiToken) {
    throw new Error(
      'Missing Jira API token. Set PI_JIRA_API_TOKEN or add apiToken to ~/.pi/agent/jira-tools.json to enable Jira search.',
    );
  }

  return `Basic ${Buffer.from(`${config.email}:${jiraApiToken}`, 'utf8').toString('base64')}`;
}
