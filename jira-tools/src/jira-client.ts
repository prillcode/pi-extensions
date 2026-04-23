import { getJiraBasicAuthHeader } from './auth.js';
import { getJiraConfig } from './config.js';
import type {
  JiraAddCommentParams,
  JiraAddCommentResult,
  JiraCloseParams,
  JiraCloseResult,
  JiraCreateIssueParams,
  JiraCreateIssueResult,
  JiraGetIssueParams,
  JiraIssueSummary,
  JiraSearchIssuesParams,
} from './types.js';

const DEFAULT_QUERY_FIELDS = [
  'summary',
  'assignee',
  'status',
  'customfield_10059',
  'issuetype',
  'customfield_10020',
] as const;

interface JiraSearchResponse {
  issues?: Array<{
    key: string;
    fields?: Record<string, unknown>;
  }>;
}

interface JiraIssueResponse {
  key?: string;
  fields?: Record<string, unknown>;
}

interface JiraTransitionsResponse {
  transitions?: Array<{
    id?: string;
    name?: string;
  }>;
}

export function getDefaultQueryFields(): readonly string[] {
  return DEFAULT_QUERY_FIELDS;
}

function buildJql(jql: string, projectKey?: string): string {
  const trimmedJql = jql.trim();

  if (!projectKey) {
    return trimmedJql;
  }

  if (/\bproject\b\s*=|\bproject\b\s+in\b/i.test(trimmedJql)) {
    return trimmedJql;
  }

  const orderByMatch = trimmedJql.match(/\border\s+by\b/i);

  if (!orderByMatch || orderByMatch.index === undefined) {
    return `project = ${projectKey} AND ${trimmedJql}`;
  }

  const filterPart = trimmedJql.slice(0, orderByMatch.index).trim();
  const orderByPart = trimmedJql.slice(orderByMatch.index).trim();

  if (!filterPart) {
    return `project = ${projectKey} ${orderByPart}`;
  }

  return `project = ${projectKey} AND ${filterPart} ${orderByPart}`;
}

function getIssueBrowseUrl(issueKey: string): string {
  return `${getJiraConfig().instanceUrl}/browse/${issueKey}`;
}

function createAdfParagraph(text: string): { type: 'paragraph'; content: Array<{ type: 'text'; text: string }> } {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text }],
  };
}

function createAdfDocument(text: string): {
  version: 1;
  type: 'doc';
  content: Array<{ type: 'paragraph'; content: Array<{ type: 'text'; text: string }> }>;
} {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd());

  const content = lines.length > 0 ? lines.map((line) => createAdfParagraph(line)) : [createAdfParagraph('')];

  return {
    version: 1,
    type: 'doc',
    content,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function normalizeSprintNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const sprint = asRecord(entry);
      if (sprint) {
        return asString(sprint.name);
      }
      return asString(entry);
    })
    .filter((name): name is string => Boolean(name));
}

function extractAdfText(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => extractAdfText(entry))
      .filter((entry): entry is string => Boolean(entry && entry.trim()));

    return parts.length > 0 ? parts.join('\n').trim() : null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const text = asString(record.text);
  if (text) {
    return text;
  }

  const content = Array.isArray(record.content) ? record.content : [];
  const childParts = content
    .map((entry) => extractAdfText(entry))
    .filter((entry): entry is string => Boolean(entry && entry.trim()));

  if (childParts.length === 0) {
    return null;
  }

  const type = asString(record.type);
  const joiner = type === 'paragraph' || type === 'bulletList' || type === 'orderedList' || type === 'listItem' ? '\n' : '';
  return childParts.join(joiner).trim();
}

function normalizeIssue(
  issue: { key: string; fields?: Record<string, unknown> },
  options?: { includeDescription?: boolean },
): JiraIssueSummary {
  const fields = issue.fields || {};
  const assignee = asRecord(fields.assignee);
  const status = asRecord(fields.status);
  const issueType = asRecord(fields.issuetype);

  return {
    key: issue.key,
    summary: asString(fields.summary) || '',
    status: asString(status?.name),
    assigneeDisplayName: asString(assignee?.displayName),
    assigneeEmail: asString(assignee?.emailAddress),
    storyPoints: asNumber(fields.customfield_10059),
    issueType: asString(issueType?.name),
    sprints: normalizeSprintNames(fields.customfield_10020),
    url: getIssueBrowseUrl(issue.key),
    description: options?.includeDescription ? extractAdfText(fields.description) : undefined,
  };
}

export async function searchJiraIssues(params: JiraSearchIssuesParams): Promise<JiraIssueSummary[]> {
  const config = getJiraConfig();
  const authHeader = await getJiraBasicAuthHeader();
  const jql = buildJql(params.jql, params.projectKey);
  const maxResults = params.maxResults ?? 50;

  const response = await fetch(`${config.instanceUrl}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jql,
      maxResults,
      fields: [...DEFAULT_QUERY_FIELDS],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jira search failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as JiraSearchResponse;
  return (data.issues || []).map(normalizeIssue);
}

export async function getJiraIssue(params: JiraGetIssueParams): Promise<JiraIssueSummary> {
  const config = getJiraConfig();
  const authHeader = await getJiraBasicAuthHeader();
  const fields = params.includeDescription ? [...DEFAULT_QUERY_FIELDS, 'description'] : [...DEFAULT_QUERY_FIELDS];

  const response = await fetch(
    `${config.instanceUrl}/rest/api/3/issue/${encodeURIComponent(params.issueKey)}?fields=${encodeURIComponent(fields.join(','))}`,
    {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jira get issue failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as JiraIssueResponse;

  if (!data.key) {
    throw new Error(`Jira get issue succeeded but no issue key was returned for ${params.issueKey}.`);
  }

  return normalizeIssue(
    {
      key: data.key,
      fields: data.fields,
    },
    { includeDescription: params.includeDescription },
  );
}

export async function createJiraIssue(params: JiraCreateIssueParams): Promise<JiraCreateIssueResult> {
  const config = getJiraConfig();
  const authHeader = await getJiraBasicAuthHeader();
  const projectKey = params.projectKey || config.defaultProjectKey;

  const fields: Record<string, unknown> = {
    project: {
      key: projectKey,
    },
    summary: params.summary,
    description: createAdfDocument(params.description),
    issuetype: {
      name: params.issueType,
    },
  };

  if (params.parentKey) {
    fields.parent = { key: params.parentKey };
  }

  if (params.labels && params.labels.length > 0) {
    fields.labels = params.labels;
  }

  if (params.assigneeAccountId) {
    fields.assignee = { accountId: params.assigneeAccountId };
  }

  if (typeof params.storyPoints === 'number') {
    fields.customfield_10059 = params.storyPoints;
  }

  const response = await fetch(`${config.instanceUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jira create issue failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { key?: string };
  const key = data.key;

  if (!key) {
    throw new Error('Jira create issue succeeded but no issue key was returned.');
  }

  return {
    key,
    url: getIssueBrowseUrl(key),
  };
}

export async function addJiraComment(params: JiraAddCommentParams): Promise<JiraAddCommentResult> {
  const config = getJiraConfig();
  const authHeader = await getJiraBasicAuthHeader();

  const response = await fetch(`${config.instanceUrl}/rest/api/3/issue/${encodeURIComponent(params.issueKey)}/comment`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      body: createAdfDocument(params.comment),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jira add comment failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { id?: string };
  const commentId = data.id;

  if (!commentId) {
    throw new Error('Jira add comment succeeded but no comment id was returned.');
  }

  return {
    issueKey: params.issueKey,
    commentId,
    url: `${getIssueBrowseUrl(params.issueKey)}?focusedCommentId=${commentId}`,
  };
}

async function getJiraTransitions(issueKey: string): Promise<Array<{ id: string; name: string }>> {
  const config = getJiraConfig();
  const authHeader = await getJiraBasicAuthHeader();

  const response = await fetch(`${config.instanceUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jira get transitions failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as JiraTransitionsResponse;
  return (data.transitions || [])
    .filter((transition): transition is { id: string; name: string } => Boolean(transition.id && transition.name));
}

function findMatchingTransition(
  transitions: Array<{ id: string; name: string }>,
  resolution: 'done' | 'cancel',
  transitionName?: string,
): { id: string; name: string } | undefined {
  if (transitionName) {
    return transitions.find((transition) => transition.name.toLowerCase() === transitionName.toLowerCase());
  }

  const donePatterns = [/^done$/i, /^closed?$/i, /^resolved?$/i, /^complete(d)?$/i];
  const cancelPatterns = [/^cancelled?$/i, /^won'?t do$/i, /^rejected$/i, /^abandoned$/i];
  const patterns = resolution === 'done' ? donePatterns : cancelPatterns;

  return transitions.find((transition) => patterns.some((pattern) => pattern.test(transition.name)));
}

async function transitionJiraIssue(issueKey: string, transitionId: string): Promise<void> {
  const config = getJiraConfig();
  const authHeader = await getJiraBasicAuthHeader();

  const response = await fetch(`${config.instanceUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transition: { id: transitionId },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jira transition issue failed (${response.status}): ${errorText}`);
  }
}

export async function closeJiraIssue(params: JiraCloseParams): Promise<JiraCloseResult> {
  const transitions = await getJiraTransitions(params.issueKey);
  const matchedTransition = findMatchingTransition(transitions, params.resolution, params.transitionName);

  if (!matchedTransition) {
    const available = transitions.map((transition) => transition.name).join(', ') || 'none';
    throw new Error(
      `No matching Jira transition found for resolution "${params.resolution}" on ${params.issueKey}. Available transitions: ${available}`,
    );
  }

  const commentResult = await addJiraComment({
    issueKey: params.issueKey,
    comment: params.comment,
  });

  await transitionJiraIssue(params.issueKey, matchedTransition.id);

  return {
    issueKey: params.issueKey,
    resolution: params.resolution,
    transitionName: matchedTransition.name,
    commentId: commentResult.commentId,
    url: getIssueBrowseUrl(params.issueKey),
  };
}
