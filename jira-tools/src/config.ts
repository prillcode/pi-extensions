import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { JiraLocalConfigFile } from './types.js';

export interface JiraExtensionConfig {
  instanceUrl: string;
  cloudId: string;
  defaultProjectKey: string;
  email: string;
  apiToken?: string;
  atlassianToken?: string;
  configSource: 'defaults' | 'file' | 'env';
  configPath?: string;
}

export function getJiraConfigPath(): string {
  return join(homedir(), '.pi', 'agent', 'jira-tools.json');
}

function readJiraConfigFile(): JiraLocalConfigFile {
  const configPath = getJiraConfigPath();

  if (!existsSync(configPath)) {
    return {};
  }

  const raw = readFileSync(configPath, 'utf8');
  return JSON.parse(raw) as JiraLocalConfigFile;
}

function parseCombinedToken(token?: string): { email?: string; apiToken?: string } {
  if (!token) {
    return {};
  }

  const separatorIndex = token.indexOf(':');
  if (separatorIndex === -1) {
    return {};
  }

  const email = token.slice(0, separatorIndex).trim();
  const apiToken = token.slice(separatorIndex + 1).trim();

  return {
    email: email || undefined,
    apiToken: apiToken || undefined,
  };
}

export function getJiraConfig(): JiraExtensionConfig {
  const fileConfig = readJiraConfigFile();
  const configPath = getJiraConfigPath();
  const envCombinedToken = process.env.PI_JIRA_ATLASSIAN_TOKEN;
  const fileCombinedToken = fileConfig.PI_JIRA_ATLASSIAN_TOKEN || fileConfig.atlassianToken;
  const combinedToken = envCombinedToken || fileCombinedToken;
  const parsedCombined = parseCombinedToken(combinedToken);

  const hasEnvOverride = Boolean(
    process.env.PI_JIRA_INSTANCE_URL ||
      process.env.PI_JIRA_CLOUD_ID ||
      process.env.PI_JIRA_DEFAULT_PROJECT_KEY ||
      process.env.PI_JIRA_EMAIL ||
      process.env.PI_JIRA_API_TOKEN ||
      process.env.PI_JIRA_ATLASSIAN_TOKEN,
  );

  const hasFileConfig = existsSync(configPath);

  return {
    instanceUrl: process.env.PI_JIRA_INSTANCE_URL || fileConfig.instanceUrl || 'https://tylertech.atlassian.net',
    cloudId: process.env.PI_JIRA_CLOUD_ID || fileConfig.cloudId || '748898e2-ca0a-43b6-981b-09e249be204c',
    defaultProjectKey: process.env.PI_JIRA_DEFAULT_PROJECT_KEY || fileConfig.defaultProjectKey || 'MDO',
    email: process.env.PI_JIRA_EMAIL || fileConfig.email || parsedCombined.email || 'aaron.prill@tylertech.com',
    apiToken: process.env.PI_JIRA_API_TOKEN || fileConfig.apiToken || parsedCombined.apiToken,
    atlassianToken: combinedToken,
    configSource: hasEnvOverride ? 'env' : hasFileConfig ? 'file' : 'defaults',
    configPath: hasFileConfig ? configPath : undefined,
  };
}
