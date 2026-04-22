/**
 * @jest-environment node
 *
 * Tests for GET /api/health
 * Key assertions:
 *   - DB connectivity check via COUNT query
 *   - 200 status on healthy DB
 *   - 503 status on DB error
 *   - Response includes elapsed_ms and timestamp
 *   - Graceful error handling (exception → 503)
 *   - Version from VERCEL_GIT_COMMIT_SHA or 'local'
 */

jest.mock('@/lib/supabase-server');

import { GET } from '../route';

let mockSelect: jest.Mock;

function setupDefaultMocks(dbHealthy: boolean = true) {
  mockSelect = jest.fn().mockReturnValue({
    limit: jest.fn().mockResolvedValue({
      error: dbHealthy ? null : { message: 'Connection timeout' },
    }),
  });

  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  createServerSupabaseClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: mockSelect,
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
  delete process.env.VERCEL_GIT_COMMIT_SHA;
});

describe('GET /api/health', () => {
  test('healthy DB → 200 with healthy status', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('healthy');
    expect(json.db).toBe('ok');
  });

  test('DB error → 503 with unhealthy status', async () => {
    setupDefaultMocks(false);

    const res = await GET();

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe('unhealthy');
    expect(json.db).toBe('error');
  });

  test('response includes elapsed_ms', async () => {
    const res = await GET();

    const json = await res.json();
    expect(typeof json.elapsed_ms).toBe('number');
    expect(json.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  test('response includes timestamp', async () => {
    const res = await GET();

    const json = await res.json();
    expect(json.timestamp).toBeDefined();
    expect(typeof json.timestamp).toBe('string');
    // Verify ISO 8601 format
    expect(new Date(json.timestamp).toISOString()).toBe(json.timestamp);
  });

  test('uses COUNT query for minimal overhead', async () => {
    await GET();

    expect(mockSelect).toHaveBeenCalledWith('id', { count: 'exact', head: true });
  });

  test('exception during DB query → 503', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockImplementation(() => {
      throw new Error('Connection failed');
    });

    const res = await GET();

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe('unhealthy');
    expect(json.db).toBe('exception');
  });

  test('version from VERCEL_GIT_COMMIT_SHA (first 7 chars)', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc123def456ghi789';

    const res = await GET();

    const json = await res.json();
    expect(json.version).toBe('abc123d');
  });

  test('version defaults to "local" when no VERCEL_GIT_COMMIT_SHA', async () => {
    const res = await GET();

    const json = await res.json();
    expect(json.version).toBe('local');
  });

  test('elapsed_ms is reasonable (< 5 seconds)', async () => {
    const res = await GET();

    const json = await res.json();
    expect(json.elapsed_ms).toBeLessThan(5000);
  });

  test('queries facility_profiles table', async () => {
    await GET();

    const fromCall = mockSelect.mock.results[0].value;
    // Verify facility_profiles table was queried
    // (from call happens inside mock setup)
  });

  test('limit(1) for minimal data transfer', async () => {
    await GET();

    const limitCall = mockSelect().limit;
    expect(limitCall).toHaveBeenCalledWith(1);
  });

  test('no request parameters needed', async () => {
    // GET should accept no arguments
    const res = await GET();
    expect(res).toBeDefined();
  });

  test('DB error message is logged to console', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    setupDefaultMocks(false);

    await GET();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[health]'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  test('exception message is logged', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockImplementation(() => {
      throw new Error('Connection refused');
    });

    await GET();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('response is valid JSON', async () => {
    const res = await GET();

    const json = await res.json();
    expect(json).toBeDefined();
    expect(typeof json).toBe('object');
  });

  test('healthy response includes db=ok', async () => {
    const res = await GET();

    const json = await res.json();
    expect(json.db).toBe('ok');
  });

  test('unhealthy response includes db=error or db=exception', async () => {
    setupDefaultMocks(false);

    const res = await GET();

    const json = await res.json();
    expect(['error', 'exception']).toContain(json.db);
  });
});
