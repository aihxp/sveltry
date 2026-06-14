import { describe, expect, test } from 'bun:test';
import { channelRequest } from '../src/channels.js';

const m = {
  title: '[proj] Boom',
  text: 'p95 is 2000ms',
  severity: 'error' as const,
  url: 'https://x/1',
};

describe('channelRequest', () => {
  test('webhook posts the content to the target', () => {
    const r = channelRequest({ type: 'webhook', target: 'https://hook' }, m)!;
    expect(r.url).toBe('https://hook');
    expect(JSON.parse(r.body)).toMatchObject({ source: 'sveltry', title: '[proj] Boom' });
  });

  test('slack flattens into text', () => {
    const r = channelRequest({ type: 'slack', target: 'https://slack' }, m)!;
    expect(JSON.parse(r.body).text).toContain('[proj] Boom');
  });

  test('msteams builds a MessageCard with error color', () => {
    const r = channelRequest({ type: 'msteams', target: 'https://teams' }, m)!;
    const card = JSON.parse(r.body);
    expect(card['@type']).toBe('MessageCard');
    expect(card.themeColor).toBe('EF4444');
  });

  test('pagerduty triggers an event with the routing key', () => {
    const r = channelRequest({ type: 'pagerduty', target: 'rk_123' }, m)!;
    expect(r.url).toBe('https://events.pagerduty.com/v2/enqueue');
    const b = JSON.parse(r.body);
    expect(b.routing_key).toBe('rk_123');
    expect(b.event_action).toBe('trigger');
    expect(b.payload.severity).toBe('error');
  });

  test('opsgenie uses GenieKey auth', () => {
    const r = channelRequest({ type: 'opsgenie', target: 'gk_abc' }, m)!;
    expect(r.url).toBe('https://api.opsgenie.com/v2/alerts');
    expect(r.headers.authorization).toBe('GenieKey gk_abc');
    expect(JSON.parse(r.body).priority).toBe('P2');
  });

  test('email and unknown types return null', () => {
    expect(channelRequest({ type: 'email', target: 'a@b.c' }, m)).toBeNull();
    expect(channelRequest({ type: 'carrierpigeon', target: 'x' }, m)).toBeNull();
  });
});
