import { getAtlassianBasicAuthHeader } from './auth.js';
import { getJiraConfig } from './config.js';

const DEFAULT_SPACE_KEY = 'MDO';

interface ConfluenceLinks {
  base?: string;
  webui?: string;
}

interface ConfluenceSpaceSearchResponse {
  results?: Array<{
    id?: number | string;
    key?: string;
    name?: string;
  }>;
}

interface ConfluenceContentSearchResponse {
  results?: Array<{
    id?: string;
    title?: string;
    version?: { number?: number };
    _links?: ConfluenceLinks;
  }>;
}

interface ConfluenceContentResponse {
  id?: string;
  title?: string;
  version?: { number?: number };
  _links?: ConfluenceLinks;
}

export interface ConfluencePageResult {
  pageId: string;
  pageUrl: string;
  action: 'created' | 'updated';
}

function getConfluenceApiBase(): string {
  return `${getJiraConfig().instanceUrl}/wiki/rest/api`;
}

function buildConfluencePageUrl(links?: ConfluenceLinks): string {
  const fallbackBase = `${getJiraConfig().instanceUrl}/wiki`;
  const base = links?.base || fallbackBase;
  const webui = links?.webui || '';
  return webui ? `${base}${webui}` : base;
}

function escapeCqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function confluenceFetch(path: string, init?: RequestInit): Promise<Response> {
  const authHeader = await getAtlassianBasicAuthHeader();

  return fetch(`${getConfluenceApiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  });
}

export async function getConfluenceSpace(spaceKey = DEFAULT_SPACE_KEY): Promise<{ id: string; key: string; name?: string }> {
  const params = new URLSearchParams({ spaceKey, limit: '1' });
  const response = await confluenceFetch(`/space?${params.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Confluence space lookup failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as ConfluenceSpaceSearchResponse;
  const space = data.results?.find((result) => result.id && result.key === spaceKey);

  if (!space?.id || !space.key) {
    throw new Error(`Confluence space ${spaceKey} was not found.`);
  }

  return {
    id: String(space.id),
    key: space.key,
    name: space.name,
  };
}

export async function findConfluencePageByTitle(params: {
  spaceKey?: string;
  title: string;
}): Promise<{ id: string; title: string; version: number; url: string } | null> {
  const spaceKey = params.spaceKey || DEFAULT_SPACE_KEY;
  const cql = `space = "${escapeCqlString(spaceKey)}" AND type = page AND title = "${escapeCqlString(params.title)}"`;
  const query = new URLSearchParams({ cql, limit: '10' });
  const response = await confluenceFetch(`/content/search?${query.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Confluence page search failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as ConfluenceContentSearchResponse;
  const page = data.results?.find((result) => result.id && result.title === params.title);

  if (!page?.id || !page.title) {
    return null;
  }

  return {
    id: page.id,
    title: page.title,
    version: page.version?.number ?? 1,
    url: buildConfluencePageUrl(page._links),
  };
}

async function getConfluencePageVersion(pageId: string): Promise<number> {
  const params = new URLSearchParams({ expand: 'version' });
  const response = await confluenceFetch(`/content/${encodeURIComponent(pageId)}?${params.toString()}`);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Confluence page lookup failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as ConfluenceContentResponse;
  return data.version?.number ?? 1;
}

export async function createOrUpdateConfluencePage(params: {
  title: string;
  html: string;
  spaceKey?: string;
}): Promise<ConfluencePageResult> {
  const spaceKey = params.spaceKey || DEFAULT_SPACE_KEY;
  await getConfluenceSpace(spaceKey);
  const existingPage = await findConfluencePageByTitle({ spaceKey, title: params.title });

  if (!existingPage) {
    const response = await confluenceFetch('/content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'page',
        title: params.title,
        space: { key: spaceKey },
        body: {
          storage: {
            value: params.html,
            representation: 'storage',
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Confluence page create failed (${response.status}): ${errorText}`);
    }

    const created = (await response.json()) as ConfluenceContentResponse;
    if (!created.id) {
      throw new Error('Confluence page create succeeded but no page id was returned.');
    }

    return {
      pageId: created.id,
      pageUrl: buildConfluencePageUrl(created._links),
      action: 'created',
    };
  }

  const currentVersion = await getConfluencePageVersion(existingPage.id);
  const response = await confluenceFetch(`/content/${encodeURIComponent(existingPage.id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: existingPage.id,
      type: 'page',
      title: params.title,
      space: { key: spaceKey },
      version: { number: currentVersion + 1 },
      body: {
        storage: {
          value: params.html,
          representation: 'storage',
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Confluence page update failed (${response.status}): ${errorText}`);
  }

  const updated = (await response.json()) as ConfluenceContentResponse;
  if (!updated.id) {
    throw new Error('Confluence page update succeeded but no page id was returned.');
  }

  return {
    pageId: updated.id,
    pageUrl: buildConfluencePageUrl(updated._links),
    action: 'updated',
  };
}
