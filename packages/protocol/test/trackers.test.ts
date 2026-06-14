import { describe, expect, test } from 'bun:test';
import {
  parseJiraResult,
  parseLinearResult,
  trackerRequest,
  type JiraConfig,
  type LinearConfig,
} from '../src/trackers.js';

const issue = { title: 'Boom', text: 'TypeError x 5', url: 'https://sveltry/issues/1' };

describe('trackerRequest: jira', () => {
  const cfg: JiraConfig = {
    type: 'jira',
    siteUrl: 'https://acme.atlassian.net/',
    projectKey: 'OPS',
    email: 'dev@acme.io',
    apiToken: 'tok123',
    issueTypeName: 'Bug',
  };

  test('builds the v3 create-issue request with Basic auth and ADF', () => {
    const r = trackerRequest(cfg, issue)!;
    expect(r.url).toBe('https://acme.atlassian.net/rest/api/3/issue');
    expect(r.headers.authorization).toBe(`Basic ${btoa('dev@acme.io:tok123')}`);
    const body = JSON.parse(r.body);
    expect(body.fields.project.key).toBe('OPS');
    expect(body.fields.issuetype.name).toBe('Bug');
    expect(body.fields.summary).toBe('Boom');
    // Description must be ADF (doc/paragraph/text), not a raw string.
    expect(body.fields.description.type).toBe('doc');
    expect(body.fields.description.content[0].type).toBe('paragraph');
    expect(body.fields.description.content[0].content[0].text).toBe('TypeError x 5');
  });

  test('defaults the issue type to Task and trims a trailing slash once', () => {
    const r = trackerRequest({ ...cfg, issueTypeName: undefined }, issue)!;
    expect(JSON.parse(r.body).fields.issuetype.name).toBe('Task');
    expect(r.url).toBe('https://acme.atlassian.net/rest/api/3/issue');
  });
});

describe('trackerRequest: linear', () => {
  const cfg: LinearConfig = { type: 'linear', apiKey: 'lin_key', teamId: 'team-uuid' };

  test('posts the issueCreate mutation with the raw (non-Bearer) API key', () => {
    const r = trackerRequest(cfg, issue)!;
    expect(r.url).toBe('https://api.linear.app/graphql');
    expect(r.headers.authorization).toBe('lin_key'); // NOT "Bearer lin_key"
    const body = JSON.parse(r.body);
    expect(body.query).toContain('issueCreate');
    expect(body.variables.input.teamId).toBe('team-uuid');
    expect(body.variables.input.title).toBe('Boom');
    expect(body.variables.input.description).toContain(
      '[View in Sveltry](https://sveltry/issues/1)',
    );
  });
});

describe('result parsing', () => {
  test('jira 201 yields key and a browse url', () => {
    const r = parseJiraResult(
      201,
      { key: 'OPS-7', self: 'https://x' },
      'https://acme.atlassian.net',
    );
    expect(r.ok).toBe(true);
    expect(r.key).toBe('OPS-7');
    expect(r.url).toBe('https://acme.atlassian.net/browse/OPS-7');
  });

  test('jira non-201 surfaces the error messages', () => {
    const r = parseJiraResult(
      400,
      { errorMessages: ['bad issue type'] },
      'https://acme.atlassian.net',
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('bad issue type');
  });

  test('linear success and failure are read from the JSON body, not the status', () => {
    const ok = parseLinearResult({
      data: {
        issueCreate: { success: true, issue: { identifier: 'ENG-3', url: 'https://linear/ENG-3' } },
      },
    });
    expect(ok).toEqual({ ok: true, key: 'ENG-3', url: 'https://linear/ENG-3' });
    const fail = parseLinearResult({ errors: [{ message: 'invalid team' }] });
    expect(fail.ok).toBe(false);
    expect(fail.detail).toBe('invalid team');
  });
});
