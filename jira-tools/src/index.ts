import { Type } from '@mariozechner/pi-ai';
import { defineTool, type ExtensionAPI } from '@mariozechner/pi-coding-agent';

function parseIssueKeyAndGuidance(args: string): { issueKey?: string; guidance?: string } {
  const trimmed = args.trim();
  if (!trimmed) {
    return {};
  }

  const [issueKey, ...rest] = trimmed.split(/\s+/);
  const guidance = rest.join(' ').trim();
  return {
    issueKey,
    guidance: guidance || undefined,
  };
}

import { detectJiraAuthState } from './auth.js';
import { getJiraConfig } from './config.js';
import {
  addJiraComment,
  closeJiraIssue,
  createJiraIssue,
  getDefaultQueryFields,
  getJiraIssue,
  searchJiraIssues,
} from './jira-client.js';

const jiraCreateIssueTool = defineTool({
  name: 'jira_create_issue',
  label: 'Jira Create Issue',
  description: 'Create a Jira issue. Scaffolded now; real auth/API behavior will be added next.',
  parameters: Type.Object({
    summary: Type.String({ description: 'Issue summary/title' }),
    description: Type.String({ description: 'Issue description/body text' }),
    issueType: Type.String({ description: 'Jira issue type, e.g. Story, Bug, Task' }),
    projectKey: Type.Optional(Type.String({ description: 'Jira project key; defaults to configured default project' })),
    parentKey: Type.Optional(Type.String({ description: 'Optional parent issue key' })),
    labels: Type.Optional(Type.Array(Type.String({ description: 'Issue label' }))),
    assigneeAccountId: Type.Optional(Type.String({ description: 'Optional Jira accountId for assignee' })),
    storyPoints: Type.Optional(Type.Number({ description: 'Optional story points field value' })),
  }),
  async execute(_toolCallId, params) {
    const created = await createJiraIssue(params);
    return {
      content: [
        {
          type: 'text',
          text: [
            `Created Jira ${params.issueType}: ${created.key}`,
            `summary: ${params.summary}`,
            `url: ${created.url}`,
          ].join('\n'),
        },
      ],
      details: created,
    };
  },
});

const jiraSearchIssuesTool = defineTool({
  name: 'jira_search_issues',
  label: 'Jira Search Issues',
  description: 'Search Jira using JQL and return normalized issue fields.',
  parameters: Type.Object({
    jql: Type.String({ description: 'Jira JQL query to execute' }),
    maxResults: Type.Optional(Type.Number({ description: 'Optional max result count' })),
    projectKey: Type.Optional(Type.String({ description: 'Optional project key override/helper' })),
  }),
  async execute(_toolCallId, params) {
    const issues = await searchJiraIssues(params);
    const lines = issues.map((issue) => {
      const sprintText = issue.sprints && issue.sprints.length > 0 ? issue.sprints.join(', ') : 'none';
      const assigneeText = issue.assigneeDisplayName || 'Unassigned';
      const statusText = issue.status || 'Unknown';
      const storyPointsText = issue.storyPoints ?? 'unset';
      const issueTypeText = issue.issueType || 'Unknown';

      return [
        `- ${issue.key}: ${issue.summary}`,
        `  status: ${statusText}`,
        `  assigneeDisplayName: ${assigneeText}`,
        `  assigneeEmail: ${issue.assigneeEmail || 'n/a'}`,
        `  storyPoints: ${storyPointsText}`,
        `  issueType: ${issueTypeText}`,
        `  sprints: ${sprintText}`,
        `  url: ${issue.url || 'n/a'}`,
      ].join('\n');
    });

    return {
      content: [{ type: 'text', text: [`Returned ${issues.length} Jira issues.`, ...lines].join('\n\n') }],
      details: {
        count: issues.length,
        fields: getDefaultQueryFields(),
        issues,
      },
    };
  },
});

const jiraGetIssueTool = defineTool({
  name: 'jira_get_issue',
  label: 'Jira Get Issue',
  description: 'Get a single Jira issue by key with normalized fields, optionally including description.',
  parameters: Type.Object({
    issueKey: Type.String({ description: 'Jira issue key, e.g. MDO-123' }),
    includeDescription: Type.Optional(
      Type.Boolean({ description: 'Whether to include the issue description in the normalized result' }),
    ),
  }),
  async execute(_toolCallId, params) {
    const issue = await getJiraIssue(params);
    const sprintText = issue.sprints && issue.sprints.length > 0 ? issue.sprints.join(', ') : 'none';
    const assigneeText = issue.assigneeDisplayName || 'Unassigned';
    const statusText = issue.status || 'Unknown';
    const storyPointsText = issue.storyPoints ?? 'unset';
    const issueTypeText = issue.issueType || 'Unknown';

    const lines = [
      `${issue.key}: ${issue.summary}`,
      `status: ${statusText}`,
      `assigneeDisplayName: ${assigneeText}`,
      `assigneeEmail: ${issue.assigneeEmail || 'n/a'}`,
      `storyPoints: ${storyPointsText}`,
      `issueType: ${issueTypeText}`,
      `sprints: ${sprintText}`,
      `url: ${issue.url || 'n/a'}`,
    ];

    if (params.includeDescription) {
      lines.push(`description:\n${issue.description || ''}`);
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      details: issue,
    };
  },
});

const jiraAddCommentTool = defineTool({
  name: 'jira_add_comment',
  label: 'Jira Add Comment',
  description: 'Add a comment to a Jira issue.',
  parameters: Type.Object({
    issueKey: Type.String({ description: 'Jira issue key, e.g. MDO-123' }),
    comment: Type.String({ description: 'Comment text to add to the issue' }),
  }),
  async execute(_toolCallId, params) {
    const result = await addJiraComment(params);
    return {
      content: [
        {
          type: 'text',
          text: [
            `Added Jira comment to ${result.issueKey}.`,
            `commentId: ${result.commentId}`,
            `url: ${result.url}`,
          ].join('\n'),
        },
      ],
      details: result,
    };
  },
});

const jiraCloseTool = defineTool({
  name: 'jira_close',
  label: 'Jira Close Issue',
  description: 'Add a closing comment to a Jira issue and transition it to done or cancel.',
  parameters: Type.Object({
    issueKey: Type.String({ description: 'Jira issue key, e.g. MDO-123' }),
    resolution: Type.String({ description: 'Closing resolution: done or cancel' }),
    comment: Type.String({ description: 'Closing comment text to add before transition' }),
    transitionName: Type.Optional(Type.String({ description: 'Optional explicit Jira transition name override' })),
  }),
  async execute(_toolCallId, params) {
    if (params.resolution !== 'done' && params.resolution !== 'cancel') {
      throw new Error(`Unsupported jira_close resolution: ${params.resolution}. Expected "done" or "cancel".`);
    }

    const result = await closeJiraIssue(params);
    return {
      content: [
        {
          type: 'text',
          text: [
            `Closed Jira issue ${result.issueKey}.`,
            `resolution: ${result.resolution}`,
            `transitionName: ${result.transitionName}`,
            `commentId: ${result.commentId}`,
            `url: ${result.url}`,
          ].join('\n'),
        },
      ],
      details: result,
    };
  },
});

export default function jiraToolsExtension(pi: ExtensionAPI) {
  const config = getJiraConfig();

  pi.registerTool(jiraCreateIssueTool);
  pi.registerTool(jiraSearchIssuesTool);
  pi.registerTool(jiraGetIssueTool);
  pi.registerTool(jiraAddCommentTool);
  pi.registerTool(jiraCloseTool);

  pi.registerCommand('jira-status', {
    description: 'Show Jira extension config and auth scaffold status',
    handler: async (_args, ctx) => {
      const authState = detectJiraAuthState();
      ctx.ui.notify(`Jira extension loaded for ${config.instanceUrl}`, 'info');
      ctx.ui.notify(`Default project: ${config.defaultProjectKey}`, 'info');
      ctx.ui.notify(`Configured email: ${config.email}`, 'info');
      ctx.ui.notify(`Config source: ${config.configSource}`, 'info');
      if (config.configPath) {
        ctx.ui.notify(`Config path: ${config.configPath}`, 'info');
      }
      ctx.ui.notify(`Auth mode: ${authState.mode}`, 'info');
      if (authState.source) {
        ctx.ui.notify(`Auth source candidate: ${authState.source}`, 'info');
      }
      if (authState.details) {
        ctx.ui.notify(authState.details, 'info');
      }
    },
  });

  pi.registerCommand('jira-create', {
    description: 'Create a Jira issue with explicit prompts for type, summary, and description',
    handler: async (args, ctx) => {
      const issueType = await ctx.ui.select('Jira issue type', ['Task', 'Story', 'Bug']);
      if (!issueType) {
        ctx.ui.notify('Cancelled Jira issue creation.', 'warning');
        return;
      }

      const summary = args.trim() || (await ctx.ui.input('Jira summary')) || '';
      if (!summary.trim()) {
        ctx.ui.notify('Jira issue creation requires a summary.', 'warning');
        return;
      }

      const description = await ctx.ui.editor('Jira description', '');
      if (description === undefined) {
        ctx.ui.notify('Cancelled Jira issue creation.', 'warning');
        return;
      }

      const created = await createJiraIssue({
        issueType,
        summary: summary.trim(),
        description,
        projectKey: config.defaultProjectKey,
      });

      ctx.ui.notify(`Created ${created.key}`, 'info');
      ctx.ui.notify(created.url, 'info');
    },
  });

  pi.registerCommand('jira-search', {
    description: 'Run a Jira search with explicit JQL and max results helper prompts',
    handler: async (args, ctx) => {
      const jql = args.trim() || (await ctx.ui.editor('Jira JQL', `project = ${config.defaultProjectKey} ORDER BY updated DESC`)) || '';
      if (!jql.trim()) {
        ctx.ui.notify('jira-search requires JQL.', 'warning');
        return;
      }

      const maxResultsInput = await ctx.ui.input('Max results', '10');
      if (maxResultsInput === undefined) {
        ctx.ui.notify('Cancelled jira-search.', 'warning');
        return;
      }

      const parsedMaxResults = Number.parseInt(maxResultsInput, 10);
      const maxResults = Number.isFinite(parsedMaxResults) && parsedMaxResults > 0 ? parsedMaxResults : 10;

      const prompt = [
        `Use jira_search_issues with jql ${JSON.stringify(jql.trim())} and maxResults ${maxResults}.`,
        'Show only the tool-backed normalized results.',
        'If the tool errors, report the error and do not invent issue data.',
      ].join('\n');

      if (ctx.isIdle()) {
        pi.sendUserMessage(prompt);
      } else {
        pi.sendUserMessage(prompt, { deliverAs: 'followUp' });
      }
    },
  });

  pi.registerCommand('jira-get-issue', {
    description: 'Retrieve a single Jira issue by key with optional description',
    handler: async (args, ctx) => {
      const issueKey = args.trim() || (await ctx.ui.input('Jira issue key')) || '';
      if (!issueKey.trim()) {
        ctx.ui.notify('jira-get-issue requires an issue key, e.g. /jira-get-issue MDO-123', 'warning');
        return;
      }

      const includeDescriptionChoice = await ctx.ui.select('Include description?', ['No', 'Yes']);
      if (!includeDescriptionChoice) {
        ctx.ui.notify('Cancelled jira-get-issue.', 'warning');
        return;
      }

      const includeDescription = includeDescriptionChoice === 'Yes';
      const prompt = [
        `Use jira_get_issue with issueKey ${JSON.stringify(issueKey.trim())}${includeDescription ? ' and includeDescription true' : ''}.`,
        'Show only the tool-backed normalized result.',
        'If the tool errors, report the error and do not invent issue data.',
      ].join('\n');

      if (ctx.isIdle()) {
        pi.sendUserMessage(prompt);
      } else {
        pi.sendUserMessage(prompt, { deliverAs: 'followUp' });
      }
    },
  });

  pi.registerCommand('jira-log', {
    description: 'Summarize recent session progress into a concise Jira comment for an issue key',
    handler: async (args, ctx) => {
      const parsed = parseIssueKeyAndGuidance(args);
      const issueKey = parsed.issueKey || (await ctx.ui.input('Jira issue key')) || '';

      if (!issueKey.trim()) {
        ctx.ui.notify('jira-log requires an issue key, e.g. /jira-log MDO-123', 'warning');
        return;
      }

      const intent = await ctx.ui.select('Jira comment intent', [
        'Progress update',
        'Root cause summary',
        'Fix implemented',
        'Investigation notes',
        'Blocker / risk',
      ]);

      if (!intent) {
        ctx.ui.notify('Cancelled jira-log.', 'warning');
        return;
      }

      const extraGuidance = parsed.guidance || (await ctx.ui.input('Optional extra guidance', 'optional')) || '';

      const prompt = [
        `Create a concise Jira comment for ${issueKey.trim()} and use jira_add_comment to post it.`,
        `Comment intent: ${intent}.`,
        'Focus on the most recent, relevant progress from the current session.',
        'Prefer 3-6 short bullets or a very short compact paragraph.',
        'Keep it factual, concise, and grounded in this session only.',
        'Do not invent details, tickets, dates, or outcomes that were not established in this session.',
        'If there is not enough relevant context, say so instead of guessing.',
        'If the tool errors, report the error instead of pretending the comment was added.',
        extraGuidance.trim() ? `Extra guidance: ${extraGuidance.trim()}` : undefined,
      ]
        .filter(Boolean)
        .join('\n');

      if (ctx.isIdle()) {
        pi.sendUserMessage(prompt);
      } else {
        pi.sendUserMessage(prompt, { deliverAs: 'followUp' });
      }
    },
  });

  pi.registerCommand('jira-close', {
    description: 'Add a closing comment and transition a Jira issue to done or cancel',
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const issueKey = parts[0] || (await ctx.ui.input('Jira issue key')) || '';
      const resolution = parts[1] || (await ctx.ui.select('Closing resolution', ['done', 'cancel'])) || '';

      if (!issueKey.trim()) {
        ctx.ui.notify('jira-close requires an issue key, e.g. /jira-close MDO-123 done', 'warning');
        return;
      }

      if (resolution !== 'done' && resolution !== 'cancel') {
        ctx.ui.notify('jira-close resolution must be done or cancel.', 'warning');
        return;
      }

      const commentMode = await ctx.ui.select('Closing comment mode', ['Manual', 'AI concise summary']);
      if (!commentMode) {
        ctx.ui.notify('Cancelled jira-close.', 'warning');
        return;
      }

      if (commentMode === 'Manual') {
        const comment = await ctx.ui.editor(
          'Closing Jira comment',
          resolution === 'done' ? 'Completed work and closing this issue.' : 'Closing this issue without completion.',
        );

        if (comment === undefined) {
          ctx.ui.notify('Cancelled jira-close.', 'warning');
          return;
        }

        const result = await closeJiraIssue({
          issueKey: issueKey.trim(),
          resolution,
          comment,
        });

        ctx.ui.notify(`Closed ${result.issueKey} via ${result.transitionName}`, 'info');
        ctx.ui.notify(result.url, 'info');
        return;
      }

      const aiFocus = await ctx.ui.select('AI summary focus', [
        'Fixes implemented',
        'Features added',
        'Fixes and features',
        'Cancel reason / stopping point',
      ]);

      if (!aiFocus) {
        ctx.ui.notify('Cancelled jira-close.', 'warning');
        return;
      }

      const extraGuidance = (await ctx.ui.input('Optional extra guidance', 'optional')) || '';
      const prompt = [
        `Create a very concise closing comment for ${issueKey.trim()} and use jira_close to transition it to ${resolution}.`,
        `Summary focus: ${aiFocus}.`,
        'Focus on the most recent, relevant work from the current session.',
        'Keep the closing comment extremely concise: either 2-4 short bullets or one short compact paragraph.',
        'Prefer concrete fixes implemented, features added, and any brief validation note if it was established in this session.',
        'Do not invent details, tests, deployments, or outcomes that were not established in this session.',
        'If there is not enough context, say so briefly instead of guessing.',
        'Use jira_close with the generated comment. If the tool errors, report the error instead of pretending the issue was closed.',
        extraGuidance.trim() ? `Extra guidance: ${extraGuidance.trim()}` : undefined,
      ]
        .filter(Boolean)
        .join('\n');

      if (ctx.isIdle()) {
        pi.sendUserMessage(prompt);
      } else {
        pi.sendUserMessage(prompt, { deliverAs: 'followUp' });
      }
    },
  });

  pi.on('session_start', async (_event, ctx) => {
    ctx.ui.setStatus('jira-tools', `Jira: ${config.defaultProjectKey}`);
  });
}
