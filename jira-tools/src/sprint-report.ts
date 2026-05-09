import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createOrUpdateConfluencePage } from './confluence-client.js';
import { getJiraConfig } from './config.js';
import { searchDoneSprintIssues } from './jira-client.js';
import type {
  JiraGenerateSprintReportParams,
  JiraGenerateSprintReportResult,
  JiraIssueSummary,
  JiraSprintInfo,
  JiraSprintReportStats,
} from './types.js';

interface SprintReportIssue extends JiraIssueSummary {
  storyPointsValue: number;
  hasStoryPoints: boolean;
}

interface SprintReportAssigneeGroup {
  assignee: string;
  email: string;
  issueCount: number;
  storyPoints: number;
  issues: SprintReportIssue[];
}

interface SprintReportData {
  sprintNames: string[];
  projectKey: string;
  generatedAtIso: string;
  generatedAtDisplay: string;
  jql: string;
  sprintDetails: JiraSprintInfo[];
  stats: JiraSprintReportStats;
  assigneeGroups: SprintReportAssigneeGroup[];
  issuesWithoutPoints: SprintReportIssue[];
}

function normalizeSprintNames(sprintNames: string[]): string[] {
  return [...new Set(sprintNames.map((name) => name.trim()).filter(Boolean))];
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatIsoDate(value?: string | null): string {
  if (!value) {
    return 'n/a';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 10);
}

function formatSprintGoalLine(sprint: JiraSprintInfo): string {
  return `${sprint.name}: ${sprint.goal || 'n/a'}`;
}

function formatSprintDateLine(sprint: JiraSprintInfo): string {
  return `${sprint.name}: ${formatIsoDate(sprint.startDate)} → ${formatIsoDate(sprint.endDate)} (Completed: ${formatIsoDate(sprint.completeDate)})`;
}

function getReportFileName(sprintNames: string[]): string {
  return `sprint-${sprintNames.join('-')}-report.md`;
}

function buildJql(projectKey: string, sprintNames: string[]): string {
  const escaped = sprintNames.map((name) => `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `project = ${projectKey} AND sprint IN (${escaped.join(', ')}) AND status = Done ORDER BY assignee`;
}

function collectSprintDetails(sprintNames: string[], issues: JiraIssueSummary[]): JiraSprintInfo[] {
  const byName = new Map<string, JiraSprintInfo>();

  for (const issue of issues) {
    for (const sprint of issue.sprintDetails || []) {
      if (!byName.has(sprint.name)) {
        byName.set(sprint.name, sprint);
      }
    }
  }

  return sprintNames.map((name) => byName.get(name) || { name });
}

function sortIssues(issues: SprintReportIssue[]): SprintReportIssue[] {
  return [...issues].sort((a, b) => a.key.localeCompare(b.key));
}

function buildReportData(sprintNames: string[], issues: JiraIssueSummary[]): SprintReportData {
  const projectKey = getJiraConfig().defaultProjectKey;
  const generatedAt = new Date();
  const normalizedIssues: SprintReportIssue[] = issues.map((issue) => ({
    ...issue,
    storyPointsValue: typeof issue.storyPoints === 'number' ? issue.storyPoints : 0,
    hasStoryPoints: typeof issue.storyPoints === 'number',
  }));

  const grouped = new Map<string, SprintReportAssigneeGroup>();

  for (const issue of normalizedIssues) {
    const assignee = issue.assigneeDisplayName || 'Unassigned';
    const email = issue.assigneeEmail || 'n/a';
    const key = `${assignee}__${email}`;
    const group = grouped.get(key) || {
      assignee,
      email,
      issueCount: 0,
      storyPoints: 0,
      issues: [],
    };

    group.issueCount += 1;
    group.storyPoints += issue.storyPointsValue;
    group.issues.push(issue);
    grouped.set(key, group);
  }

  const assigneeGroups = [...grouped.values()]
    .map((group) => ({
      ...group,
      issues: sortIssues(group.issues),
    }))
    .sort((a, b) => a.assignee.localeCompare(b.assignee));

  const issuesWithoutPoints = sortIssues(normalizedIssues.filter((issue) => !issue.hasStoryPoints));
  const stats: JiraSprintReportStats = {
    totalIssues: normalizedIssues.length,
    totalStoryPoints: normalizedIssues.reduce((sum, issue) => sum + issue.storyPointsValue, 0),
    teamMemberCount: assigneeGroups.length,
    issuesWithoutPoints: issuesWithoutPoints.length,
  };

  return {
    sprintNames,
    projectKey,
    generatedAtIso: generatedAt.toISOString(),
    generatedAtDisplay: generatedAt.toISOString().slice(0, 10),
    jql: buildJql(projectKey, sprintNames),
    sprintDetails: collectSprintDetails(sprintNames, normalizedIssues),
    stats,
    assigneeGroups,
    issuesWithoutPoints,
  };
}

function buildMarkdown(report: SprintReportData): string {
  const headerGoals = report.sprintDetails.map((sprint) => `  - ${formatSprintGoalLine(sprint)}`).join('\n');
  const headerDates = report.sprintDetails.map((sprint) => `  - ${formatSprintDateLine(sprint)}`).join('\n');

  const quickSummaryTable = [
    '| Total Issues | Total Story Points | Team Member Count | Issues Without Points |',
    '|---|---:|---:|---:|',
    `| ${report.stats.totalIssues} | ${report.stats.totalStoryPoints} | ${report.stats.teamMemberCount} | ${report.stats.issuesWithoutPoints} |`,
  ].join('\n');

  const summaryRows = report.assigneeGroups.map(
    (group) => `| ${escapeMarkdownCell(group.assignee)} | ${escapeMarkdownCell(group.email)} | ${group.issueCount} | ${group.storyPoints} |`,
  );
  const summaryTable = [
    '| Assignee | Email | Completed Issues | Total Story Points |',
    '|---|---|---:|---:|',
    ...summaryRows,
  ].join('\n');

  const details = report.assigneeGroups
    .map((group) => {
      const issueRows = group.issues.map(
        (issue) =>
          `| ${issue.key} | ${escapeMarkdownCell(issue.issueType || 'Unknown')} | ${escapeMarkdownCell(issue.summary)} | ${issue.hasStoryPoints ? issue.storyPointsValue : 'unset'} |`,
      );

      return [
        `### ${group.assignee}`,
        '',
        `- Email: ${group.email}`,
        `- Completed issues: ${group.issueCount}`,
        `- Total story points: ${group.storyPoints}`,
        '',
        '| Key | Type | Summary | Points |',
        '|---|---|---|---:|',
        ...issueRows,
      ].join('\n');
    })
    .join('\n\n');

  const withoutPoints =
    report.issuesWithoutPoints.length === 0
      ? '- None'
      : report.issuesWithoutPoints
          .map((issue) => `- ${issue.key} — ${issue.assigneeDisplayName || 'Unassigned'} — ${issue.summary}`)
          .join('\n');

  return [
    `# Sprint Report: ${report.sprintNames.join(', ')}`,
    '',
    '- Generated: ' + report.generatedAtDisplay,
    '- Sprint: ' + report.sprintNames.join(', '),
    '- Project: ' + report.projectKey,
    '- Sprint Goal:',
    headerGoals || '  - n/a',
    '- Sprint Dates:',
    headerDates || '  - n/a',
    '',
    '## Quick Summary',
    '',
    quickSummaryTable,
    '',
    '## Summary by Engineer',
    '',
    summaryTable,
    '',
    '## Detailed Breakdown',
    '',
    details || '_No completed issues found._',
    '',
    '## Issues Without Points',
    '',
    withoutPoints,
    '',
    '## Technical Notes',
    '',
    `- JQL: \`${report.jql}\``,
    `- Report generated at: ${report.generatedAtIso}`,
  ].join('\n');
}

function buildHtml(report: SprintReportData): string {
  const summaryRows = report.assigneeGroups
    .map(
      (group) =>
        `<tr><td>${escapeHtml(group.assignee)}</td><td>${escapeHtml(group.email)}</td><td>${group.issueCount}</td><td>${group.storyPoints}</td></tr>`,
    )
    .join('');

  const details = report.assigneeGroups
    .map((group) => {
      const issueRows = group.issues
        .map(
          (issue) =>
            `<tr><td>${escapeHtml(issue.key)}</td><td>${escapeHtml(issue.issueType || 'Unknown')}</td><td>${escapeHtml(issue.summary)}</td><td>${issue.hasStoryPoints ? issue.storyPointsValue : 'unset'}</td></tr>`,
        )
        .join('');

      return `
        <h3>${escapeHtml(group.assignee)}</h3>
        <ul>
          <li>Email: ${escapeHtml(group.email)}</li>
          <li>Completed issues: ${group.issueCount}</li>
          <li>Total story points: ${group.storyPoints}</li>
        </ul>
        <table>
          <tbody>
            <tr><th>Key</th><th>Type</th><th>Summary</th><th>Points</th></tr>
            ${issueRows}
          </tbody>
        </table>
      `;
    })
    .join('');

  const withoutPoints =
    report.issuesWithoutPoints.length === 0
      ? '<li>None</li>'
      : report.issuesWithoutPoints
          .map(
            (issue) => `<li>${escapeHtml(issue.key)} — ${escapeHtml(issue.assigneeDisplayName || 'Unassigned')} — ${escapeHtml(issue.summary)}</li>`,
          )
          .join('');

  const goals = report.sprintDetails.map((sprint) => `<li>${escapeHtml(formatSprintGoalLine(sprint))}</li>`).join('');
  const dates = report.sprintDetails.map((sprint) => `<li>${escapeHtml(formatSprintDateLine(sprint))}</li>`).join('');

  return `
    <h1>${escapeHtml(`Sprint Report: ${report.sprintNames.join(', ')}`)}</h1>
    <ul>
      <li>Generated: ${escapeHtml(report.generatedAtDisplay)}</li>
      <li>Sprint: ${escapeHtml(report.sprintNames.join(', '))}</li>
      <li>Project: ${escapeHtml(report.projectKey)}</li>
    </ul>
    <h2>Sprint Goal</h2>
    <ul>${goals || '<li>n/a</li>'}</ul>
    <h2>Sprint Dates</h2>
    <ul>${dates || '<li>n/a</li>'}</ul>
    <h2>Quick Summary</h2>
    <table>
      <tbody>
        <tr><th>Total Issues</th><th>Total Story Points</th><th>Team Member Count</th><th>Issues Without Points</th></tr>
        <tr><td>${report.stats.totalIssues}</td><td>${report.stats.totalStoryPoints}</td><td>${report.stats.teamMemberCount}</td><td>${report.stats.issuesWithoutPoints}</td></tr>
      </tbody>
    </table>
    <h2>Summary by Engineer</h2>
    <table>
      <tbody>
        <tr><th>Assignee</th><th>Email</th><th>Completed Issues</th><th>Total Story Points</th></tr>
        ${summaryRows}
      </tbody>
    </table>
    <h2>Detailed Breakdown</h2>
    ${details || '<p>No completed issues found.</p>'}
    <h2>Issues Without Points</h2>
    <ul>${withoutPoints}</ul>
    <h2>Technical Notes</h2>
    <ul>
      <li>JQL: <code>${escapeHtml(report.jql)}</code></li>
      <li>Report generated at: ${escapeHtml(report.generatedAtIso)}</li>
    </ul>
  `;
}

export async function generateSprintReport(params: JiraGenerateSprintReportParams): Promise<JiraGenerateSprintReportResult> {
  const sprintNames = normalizeSprintNames(params.sprintNames);
  if (sprintNames.length === 0) {
    throw new Error('At least one sprint name is required to generate a sprint report.');
  }

  const issues = await searchDoneSprintIssues(sprintNames, getJiraConfig().defaultProjectKey);
  const report = buildReportData(sprintNames, issues);
  const markdown = buildMarkdown(report);
  const html = buildHtml(report);

  const outputDir = path.resolve(process.cwd(), params.outputDir || '.');
  await mkdir(outputDir, { recursive: true });

  const filePath = path.join(outputDir, getReportFileName(sprintNames));
  await writeFile(filePath, `${markdown}\n`, 'utf8');

  if (!params.publish) {
    return {
      sprintNames,
      filePath,
      stats: report.stats,
    };
  }

  const confluenceResult = await createOrUpdateConfluencePage({
    title: `Sprint Report: ${sprintNames.join(', ')}`,
    html,
    spaceKey: 'MDO',
  });

  return {
    sprintNames,
    filePath,
    stats: report.stats,
    pageId: confluenceResult.pageId,
    pageUrl: confluenceResult.pageUrl,
    pageAction: confluenceResult.action,
  };
}
