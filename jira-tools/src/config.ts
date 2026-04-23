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

export function getJiraConfig(): JiraExtensionConfig {
  const fileConfig = readJiraConfigFile();
  const configPath = getJiraConfigPath();

  const hasEnvOverride = Boolean(
    process.env.PI_JIRA_INSTANCE_URL ||
      process.env.PI_JIRA_CLOUD_ID ||
      process.env.PI_JIRA_DEFAULT_PROJECT_KEY ||
      process.env.PI_JIRA_EMAIL ||
      process.env.PI_JIRA_API_TOKEN,
  );

  const hasFileConfig = existsSync(configPath);

  return {
    instanceUrl: process.env.PI_JIRA_INSTANCE_URL || fileConfig.instanceUrl || 'https://tylertech.atlassian.net',
    cloudId: process.env.PI_JIRA_CLOUD_ID || fileConfig.cloudId || '748898e2-ca0a-43b6-981b-09e249be204c',
    defaultProjectKey: process.env.PI_JIRA_DEFAULT_PROJECT_KEY || fileConfig.defaultProjectKey || 'MDO',
    email: process.env.PI_JIRA_EMAIL || fileConfig.email || 'aaron.prill@tylertech.com',
    apiToken: process.env.PI_JIRA_API_TOKEN || fileConfig.apiToken,
    configSource: hasEnvOverride ? 'env' : hasFileConfig ? 'file' : 'defaults',
    configPath: hasFileConfig ? configPath : undefined,
  };
}
