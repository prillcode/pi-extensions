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

  if (config.apiToken || config.atlassianToken) {
    return {
      mode: 'basic-auth-ready',
      source:
        config.configSource === 'env'
          ? config.atlassianToken
            ? 'PI_JIRA_ATLASSIAN_TOKEN'
            : 'PI_JIRA_EMAIL + PI_JIRA_API_TOKEN'
          : config.configPath,
      details: `Basic auth is configured for ${config.email} via ${config.configSource}.`,
    };
  }

  if (existsSync(claudeCredentialsPath)) {
    return {
      mode: 'oauth-reuse-candidate',
      source: claudeCredentialsPath,
      details:
        'Claude Atlassian credentials were found, but direct Jira REST reuse was not validated. Set PI_JIRA_API_TOKEN, PI_JIRA_ATLASSIAN_TOKEN, or ~/.pi/agent/jira-tools.json for the working read path.',
    };
  }

  return {
    mode: 'unconfigured',
    details:
      'Set PI_JIRA_EMAIL and PI_JIRA_API_TOKEN, set PI_JIRA_ATLASSIAN_TOKEN, or create ~/.pi/agent/jira-tools.json to enable Jira/Confluence REST access.',
  };
}

export async function getAtlassianBasicAuthHeader(): Promise<string> {
  const config = getJiraConfig();

  if (config.atlassianToken) {
    return `Basic ${Buffer.from(config.atlassianToken, 'utf8').toString('base64')}`;
  }

  if (config.apiToken) {
    return `Basic ${Buffer.from(`${config.email}:${config.apiToken}`, 'utf8').toString('base64')}`;
  }

  throw new Error(
    'Missing Atlassian API token. Set PI_JIRA_API_TOKEN, set PI_JIRA_ATLASSIAN_TOKEN, or add one of them to ~/.pi/agent/jira-tools.json to enable Jira/Confluence access.',
  );
}

export async function getJiraBasicAuthHeader(): Promise<string> {
  return getAtlassianBasicAuthHeader();
}
