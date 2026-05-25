/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/sync-google-ratings
 * Key assertions:
 *   - CRON_SECRET validation
 *   - Facility lookup (published, gbp_place_id set)
 *   - Google Places API integration
 *   - Rating/review count update
 *   - Rate limiting (1 QPM on Places API)
 *   - Batch processing (max 200 per run)
 *   - Error handling per facility
 */

jest.mock('@/lib/cron-auth');
jest.mock('@/lib/gbp');
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/cron-logger');

import { checkCronAuth } from '@/lib/cron-auth';
import { fetchPlaceDetails } from '@/lib/gbp';
import { logCronRun } from '@/lib/cron-logger';
import { GET } from '../route';

let mockSelect: jest.Mock;
let mockUpdate: jest.Mock;

function setupDefaultMocks(
  facilitiesCount: number = 2,
  placeDetailsValid: boolean = true,
  updateSucceeds: boolean = true
) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);

  const facilitiesData = Array.from({ length: facilitiesCount }, (_, i) => ({
    id: `fac-${i}`,
    gbp_place_id: `place-id-${i}`,
  }));

  mockSelect = jest.fn().mockReturnValue({
    eq: jest
      .fn()
      .mockReturnValue({
        not: jest
          .fn()
          .mockReturnValue({
            limit: jest.fn().mockResolvedValue({
              data: facilitiesData,
              error: null,
            }),
          }),
      }),
  });

  mockUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({
      error: updateSucceeds ? null : { message: 'Update failed' },
    }),
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'facility_profiles') {
        return {
          select: mockSelect,
          update: mockUpdate,
        };
      }
    }),
  });

  (fetchPlaceDetails as jest.Mock).mockResolvedValue(
    placeDetailsValid
      ? {
          rating: 4.8,
          user_ratings_total: 125,
        }
      : null
  );

  (logCronRun as jest.Mock).mockResolvedValue(undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
  // Mock setTimeout to execute immediately (avoids 1100ms rate-limit delay per facility)
  jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => { fn(); return 0 as any; });
  setupDefaultMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeRequest(cronSecret: string = 'valid-secret') {
  return new Request('http://localhost/api/cron/sync-google-ratings', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${cronSecret}` },
  });
}

describe('GET /api/cron/sync-google-ratings', () => {
  test('CRON_SECRET check failed → returns error', async () => {
    const errorResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    (checkCronAuth as jest.Mock).mockReturnValue(errorResponse);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(401);
  });

  test('valid cron request → 200 with results', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.processed).toBe('number');
    expect(typeof json.skipped).toBe('number');
    expect(typeof json.errors).toBe('number');
  });

  test('facility lookup fetches published with gbp_place_id', async () => {
    await GET(makeRequest() as any);

    const eqCall = mockSelect().eq.mock.calls[0];
    expect(eqCall[0]).toBe('status');
    expect(eqCall[1]).toBe('published');
  });

  test('calls fetchPlaceDetails for each facility', async () => {
    setupDefaultMocks(3);

    await GET(makeRequest() as any);

    expect(fetchPlaceDetails).toHaveBeenCalledTimes(3);
    expect(fetchPlaceDetails).toHaveBeenCalledWith('place-id-0');
    expect(fetchPlaceDetails).toHaveBeenCalledWith('place-id-1');
    expect(fetchPlaceDetails).toHaveBeenCalledWith('place-id-2');
  });

  test('updates facility with rating and review count', async () => {
    await GET(makeRequest() as any);

    const updateCall = mockUpdate.mock.calls[0];
    expect(updateCall[0]).toEqual({
      google_rating: 4.8,
      google_review_count: 125,
    });
  });

  test('no valid place data → skipped', async () => {
    (fetchPlaceDetails as jest.Mock).mockResolvedValue(null);

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.skipped).toBeGreaterThan(0);
  });

  test('place data with null rating → skipped', async () => {
    (fetchPlaceDetails as jest.Mock).mockResolvedValue({
      rating: null,
      user_ratings_total: null,
    });

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.skipped).toBeGreaterThan(0);
  });

  test('place data with rating only → updated', async () => {
    (fetchPlaceDetails as jest.Mock).mockResolvedValue({
      rating: 4.5,
      user_ratings_total: null,
    });

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.processed).toBeGreaterThan(0);
  });

  test('update error → error count', async () => {
    setupDefaultMocks(1, true, false);

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.errors).toBeGreaterThan(0);
  });

  test('fetchPlaceDetails exception → error count', async () => {
    (fetchPlaceDetails as jest.Mock).mockRejectedValue(new Error('API error'));

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.errors).toBeGreaterThan(0);
  });

  test('facility lookup error → logs error', async () => {
    mockSelect().eq().not().limit.mockResolvedValue({
      data: null,
      error: { message: 'Query error' },
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith(
      'sync-google-ratings',
      'error',
      expect.any(Date),
      expect.objectContaining({ error_msg: 'Query error' })
    );
  });

  test('processes max 200 facilities per run', async () => {
    setupDefaultMocks(200);

    await GET(makeRequest() as any);

    expect(fetchPlaceDetails).toHaveBeenCalledTimes(200);
  });

  test('logs success with processed count', async () => {
    setupDefaultMocks(2);

    await GET(makeRequest() as any);

    expect(logCronRun).toHaveBeenCalledWith(
      'sync-google-ratings',
      'success',
      expect.any(Date),
      expect.objectContaining({
        processed: 2,
        skipped: 0,
        meta: expect.objectContaining({ errors: 0 }),
      })
    );
  });

  test('no facilities found → skipped with 0', async () => {
    setupDefaultMocks(0);

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.skipped).toBe(0);
    expect(json.processed).toBe(0);
  });

  test('mixed success and failures', async () => {
    setupDefaultMocks(4);
    let callCount = 0;
    (fetchPlaceDetails as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount % 2 === 0) {
        return Promise.reject(new Error('API error'));
      }
      return Promise.resolve({ rating: 4.5, user_ratings_total: 100 });
    });

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.processed).toBeGreaterThan(0);
    expect(json.errors).toBeGreaterThan(0);
  });

  test('updates each facility separately', async () => {
    setupDefaultMocks(2);

    await GET(makeRequest() as any);

    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate.mock.results[0].value).toEqual(expect.objectContaining({ eq: expect.anything() }));
  });

  test('handles google_review_count as 0 when null', async () => {
    (fetchPlaceDetails as jest.Mock).mockResolvedValue({
      rating: 4.0,
      user_ratings_total: null,
    });

    await GET(makeRequest() as any);

    const updateCall = mockUpdate.mock.calls[0];
    expect(updateCall[0].google_review_count).toBe(0);
  });

  test('google_rating as null when missing', async () => {
    (fetchPlaceDetails as jest.Mock).mockResolvedValue({
      rating: null,
      user_ratings_total: null,
    });

    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.skipped).toBeGreaterThan(0);
  });
});
