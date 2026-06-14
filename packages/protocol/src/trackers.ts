/**
 * Issue-tracker request builders. Given a per-project integration config and a
 * generic issue payload, produce the HTTP request (url, headers, body) that
 * creates a ticket in Jira or Linear. Pure and unit-tested, mirroring
 * `channelRequest` in channels.ts, so the backend's outbound action stays thin.
 *
 * Self-hosters supply their own credentials; Sveltry never needs them at build
 * time. Jira Cloud uses the REST v3 create-issue endpoint with Basic auth and an
 * Atlassian Document Format body; Linear uses the GraphQL `issueCreate` mutation
 * with the raw API key as the Authorization header (no `Bearer` prefix).
 */

export interface JiraConfig {
  type: 'jira';
  /** The Jira Cloud base, e.g. https://your-domain.atlassian.net */
  siteUrl: string;
  /** Project key, e.g. PROJ. */
  projectKey: string;
  /** Atlassian account email (the Basic-auth username). */
  email: string;
  /** Atlassian API token (the Basic-auth password). */
  apiToken: string;
  /** Issue type name, e.g. Bug / Task / Story. Defaults to Task. */
  issueTypeName?: string;
}

export interface LinearConfig {
  type: 'linear';
  /** Linear personal API key (sent as the raw Authorization header value). */
  apiKey: string;
  /** Target team UUID (not the short team key). */
  teamId: string;
}

export type TrackerConfig = JiraConfig | LinearConfig;

export interface TrackerIssue {
  /** The ticket title / summary. */
  title: string;
  /** Plain-text / markdown body. */
  text: string;
  /** A link back to the Sveltry issue, if available. */
  url?: string;
}

export interface TrackerRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Base64-encode an ASCII string (Basic-auth credential) in any JS runtime. */
function base64(input: string): string {
  if (typeof btoa === 'function') return btoa(input);
  // Node fallback for environments without btoa.
  return Buffer.from(input, 'utf8').toString('base64');
}

/** A minimal Atlassian Document Format doc wrapping plain-text paragraphs. */
function adf(paragraphs: string[]): unknown {
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  };
}

/** Build the create-issue request for a tracker, or null for an unknown type. */
export function trackerRequest(config: TrackerConfig, issue: TrackerIssue): TrackerRequest | null {
  switch (config.type) {
    case 'jira': {
      const paragraphs = [issue.text];
      if (issue.url) paragraphs.push(`View in Sveltry: ${issue.url}`);
      return {
        url: `${config.siteUrl.replace(/\/+$/, '')}/rest/api/3/issue`,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Basic ${base64(`${config.email}:${config.apiToken}`)}`,
        },
        body: JSON.stringify({
          fields: {
            project: { key: config.projectKey },
            summary: issue.title.slice(0, 255),
            issuetype: { name: config.issueTypeName?.trim() || 'Task' },
            description: adf(paragraphs),
          },
        }),
      };
    }
    case 'linear': {
      const description = issue.url
        ? `${issue.text}\n\n[View in Sveltry](${issue.url})`
        : issue.text;
      return {
        url: 'https://api.linear.app/graphql',
        headers: {
          'content-type': 'application/json',
          authorization: config.apiKey,
        },
        body: JSON.stringify({
          query:
            'mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url title } } }',
          variables: { input: { teamId: config.teamId, title: issue.title, description } },
        }),
      };
    }
    default:
      return null;
  }
}

/** A created ticket, parsed from a provider response. */
export interface TrackerResult {
  ok: boolean;
  key?: string;
  url?: string;
  detail?: string;
}

/** Interpret a Jira create-issue response (201 with { key, self } on success). */
export function parseJiraResult(status: number, body: unknown, siteUrl: string): TrackerResult {
  if (status === 201 && body && typeof body === 'object') {
    const b = body as { key?: string };
    const key = b.key;
    return {
      ok: true,
      key,
      url: key ? `${siteUrl.replace(/\/+$/, '')}/browse/${key}` : undefined,
    };
  }
  const errors =
    body && typeof body === 'object' ? (body as { errorMessages?: string[] }).errorMessages : null;
  return { ok: false, detail: errors?.join('; ') || `HTTP ${status}` };
}

/** Interpret a Linear GraphQL response (200 with data.issueCreate.success). */
export function parseLinearResult(body: unknown): TrackerResult {
  const data =
    (body as {
      data?: { issueCreate?: { success?: boolean; issue?: { identifier?: string; url?: string } } };
      errors?: { message?: string }[];
    } | null) ?? null;
  const created = data?.data?.issueCreate;
  if (created?.success) {
    return { ok: true, key: created.issue?.identifier, url: created.issue?.url };
  }
  const detail = data?.errors
    ?.map((e) => e.message)
    .filter(Boolean)
    .join('; ');
  return { ok: false, detail: detail || 'issueCreate failed' };
}
