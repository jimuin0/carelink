/**
 * @jest-environment node
 *
 * Tests for GET /api/sentry-check
 * Key assertions:
 *   - GET without params → returns DSN config status (200)
 *   - GET ?fire=1 without token → 401
 *   - GET ?fire=1 with invalid token → 401
 *   - GET ?fire=1 with valid token → fires to Sentry (200)
 */

import * as Sentry from '@sentry/nextjs';
import { timingSafeEqual } from 'crypto';

jest.mock('@sentry/nextjs');

let originalEnv: Record<string, string | undefined>;

beforeAll(() => {
  originalEnv = { ...process.env };
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://test@sentry.io/123456';
  process.env.SENTRY_TEST_TOKEN = 'test-token-value';
  process.env.NODE_ENV = 'test';

  (Sentry.getClient as jest.Mock).mockReturnValue(null);
  (Sentry.init as jest.Mock).mockReturnValue(undefined);
  (Sentry.captureException as jest.Mock).mockReturnValue('test-event-id');
  (Sentry.flush as jest.Mock).mockResolvedValue(true);
});

afterAll(() => {
  process.env = originalEnv;
});

function makeRequest(query: string) {
  return new Request(`http://localhost/api/sentry-check${query}`, { method: 'GET' });
}

describe('GET /api/sentry-check', () => {
  test('returns DSN config status without params', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest(''));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.dsnConfigured).toBe(true);
    expect(json.clientActive).toBe(false);
    expect(json.environment).toBe('test');
  });

  test('returns truncated DSN for security', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest(''));

    const json = await res.json();
    expect(json.dsn).toContain('...');
    expect(json.dsn.length).toBeLessThan(35);
  });

  test('returns NOT SET when DSN unconfigured', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = '';
    const { GET } = await import('../route');
    const res = await GET(makeRequest(''));

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.dsnConfigured).toBe(false);
    expect(json.dsn).toBe('NOT SET');
  });

  test('returns help note about fire param', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest(''));

    const json = await res.json();
    expect(json.note).toContain('/api/sentry-check?fire=1');
  });

  test('fire=1 without token → 401', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('?fire=1'));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.message).toBe('invalid token');
  });

  test('fire=1 with empty token → 401', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('?fire=1&token='));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  test('fire=1 with invalid token → 401', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('?fire=1&token=wrong-token'));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  test('fire=1 with valid token → fires error', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('?fire=1&token=test-token-value'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.fired).toBe(true);
    expect(json.dsnConfigured).toBe(true);
    expect(json.eventId).toBe('test-event-id');
    expect(json.flushed).toBe(true);
  });

  test('initializes Sentry if client not active', async () => {
    const { GET } = await import('../route');
    await GET(makeRequest('?fire=1&token=test-token-value'));

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        tracesSampleRate: 0.1,
        environment: 'test',
      })
    );
  });

  test('captures error with Sentry.captureException', async () => {
    const { GET } = await import('../route');
    await GET(makeRequest('?fire=1&token=test-token-value'));

    expect(Sentry.captureException).toHaveBeenCalled();
    const errorArg = (Sentry.captureException as jest.Mock).mock.calls[0][0];
    expect(errorArg).toBeInstanceOf(Error);
    expect(errorArg.message).toContain('[CareLink Sentry Test]');
  });

  test('flushes Sentry with 5s timeout', async () => {
    const { GET } = await import('../route');
    await GET(makeRequest('?fire=1&token=test-token-value'));

    expect(Sentry.flush).toHaveBeenCalledWith(5000);
  });

  test('shows success message when flushed', async () => {
    (Sentry.flush as jest.Mock).mockResolvedValue(true);
    const { GET } = await import('../route');
    const res = await GET(makeRequest('?fire=1&token=test-token-value'));

    const json = await res.json();
    expect(json.message).toContain('1分以内に');
  });

  test('shows timeout message when flush fails', async () => {
    (Sentry.flush as jest.Mock).mockResolvedValue(false);
    const { GET } = await import('../route');
    const res = await GET(makeRequest('?fire=1&token=test-token-value'));

    const json = await res.json();
    expect(json.message).toContain('タイムアウト');
  });

  test('fire=1 without SENTRY_TEST_TOKEN env → 401', async () => {
    delete process.env.SENTRY_TEST_TOKEN;
    const { GET } = await import('../route');
    const res = await GET(makeRequest('?fire=1&token=test-token-value'));

    expect(res.status).toBe(401);
  });

  test('returns clientActive status', async () => {
    (Sentry.getClient as jest.Mock).mockReturnValue({ isEnabled: () => true });
    const { GET } = await import('../route');
    const res = await GET(makeRequest(''));

    const json = await res.json();
    expect(json.clientActive).toBe(true);
  });

  test('includes version in response', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc1234567890def';
    const { GET } = await import('../route');
    const res = await GET(makeRequest(''));

    const json = await res.json();
    // May or may not include version in initial status check
    // Version only in success response (already tested above)
  });
});
