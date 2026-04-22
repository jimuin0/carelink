/**
 * @jest-environment node
 */

jest.mock('@sentry/nextjs');

import { GET } from '../route';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://xxx@sentry.io/123';
  process.env.SENTRY_TEST_TOKEN = 'test-token-secret';
  process.env.NODE_ENV = 'production';
});

function makeRequest(query: string = '', url: string = 'http://localhost/api/sentry-check') {
  const fullUrl = query ? `${url}${query}` : url;
  return new Request(fullUrl, { method: 'GET' });
}

describe('GET /api/sentry-check', () => {
  test('no parameters → returns status without firing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.dsnConfigured).toBe(true);
    expect(json.fired).toBeUndefined();
  });

  test('includes note about how to fire', async () => {
    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json.note).toContain('fire=1');
    expect(json.note).toContain('token=');
  });

  test('DSN configured → dsnConfigured true', async () => {
    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json.dsnConfigured).toBe(true);
  });

  test('DSN not configured → dsnConfigured false', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json.dsnConfigured).toBe(false);
    expect(json.dsn).toBe('NOT SET');
  });

  test('fire=1 without token → 401', async () => {
    const res = await GET(makeRequest('?fire=1'));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  test('fire=1 with invalid token → 401', async () => {
    const res = await GET(makeRequest('?fire=1&token=wrong-token'));
    expect(res.status).toBe(401);
  });

  test('fire=1 with valid token → 200 fired=true', async () => {
    const { getClient, flush } = require('@sentry/nextjs');
    getClient.mockReturnValue(null);
    (flush as jest.Mock).mockResolvedValue(true);

    const res = await GET(makeRequest('?fire=1&token=test-token-secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.fired).toBe(true);
  });

  test('includes DSN masked in response (truncated with ...)', async () => {
    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json.dsn).toMatch(/\.\.\./);
    expect(json.dsn.length).toBeLessThan(60);
  });

  test('includes client active status', async () => {
    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json.clientActive).toBeDefined();
  });

  test('includes environment', async () => {
    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json.environment).toBe('production');
  });

  test('fire with flush success → message about checking dashboard', async () => {
    const { getClient, flush, captureException } = require('@sentry/nextjs');
    getClient.mockReturnValue({});
    (flush as jest.Mock).mockResolvedValue(true);
    (captureException as jest.Mock).mockReturnValue('event-id-123');

    const res = await GET(makeRequest('?fire=1&token=test-token-secret'));
    const json = await res.json();
    expect(json.message).toContain('ダッシュボード');
    expect(json.flushed).toBe(true);
  });

  test('fire with flush timeout → message about timeout', async () => {
    const { getClient, flush, captureException } = require('@sentry/nextjs');
    getClient.mockReturnValue({});
    (flush as jest.Mock).mockResolvedValue(false);
    (captureException as jest.Mock).mockReturnValue('event-id-123');

    const res = await GET(makeRequest('?fire=1&token=test-token-secret'));
    const json = await res.json();
    expect(json.message).toContain('タイムアウト');
    expect(json.flushed).toBe(false);
  });

  test('includes eventId when fired', async () => {
    const { getClient, flush, captureException } = require('@sentry/nextjs');
    getClient.mockReturnValue({});
    (flush as jest.Mock).mockResolvedValue(true);
    (captureException as jest.Mock).mockReturnValue('event-id-abc123');

    const res = await GET(makeRequest('?fire=1&token=test-token-secret'));
    const json = await res.json();
    expect(json.eventId).toBe('event-id-abc123');
  });

  test('fire without SENTRY_TEST_TOKEN env → 401', async () => {
    delete process.env.SENTRY_TEST_TOKEN;
    const res = await GET(makeRequest('?fire=1&token=any-token'));
    expect(res.status).toBe(401);
  });
});
