export interface JiraIssueSummary {
  key: string;
  summary: string;
  status?: string;
  assigneeDisplayName?: string | null;
  assigneeEmail?: string | null;
  storyPoints?: number | null;
  issueType?: string | null;
  sprints?: string[];
  url?: string;
}

export interface JiraCreateIssueParams {
  summary: string;
  description: string;
  issueType: string;
  projectKey?: string;
  parentKey?: string;
  labels?: string[];
  assigneeAccountId?: string;
  storyPoints?: number;
}

export interface JiraCreateIssueResult {
  key: string;
  url: string;
}

export interface JiraSearchIssuesParams {
  jql: string;
  maxResults?: number;
  projectKey?: string;
}

export interface JiraAddCommentParams {
  issueKey: string;
  comment: string;
}

export interface JiraAddCommentResult {
  issueKey: string;
  commentId: string;
  url: string;
}

export interface JiraCloseParams {
  issueKey: string;
  resolution: 'done' | 'cancel';
  comment: string;
  transitionName?: string;
}

export interface JiraCloseResult {
  issueKey: string;
  resolution: 'done' | 'cancel';
  transitionName: string;
  commentId: string;
  url: string;
}

export interface JiraAuthState {
  mode: 'unconfigured' | 'oauth-reuse-candidate' | 'basic-auth-ready';
  source?: string;
  details?: string;
}

export interface JiraLocalConfigFile {
  email?: string;
  apiToken?: string;
  instanceUrl?: string;
  cloudId?: string;
  defaultProjectKey?: string;
}
