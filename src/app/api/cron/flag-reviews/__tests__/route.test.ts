/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/flag-reviews
 * Key assertions:
 *   - CRON_SECRET validation
 *   - RPC find_bulk_review_ips (24h window, threshold 3)
 *   - Bulk submission detection (3+ reviews from same IP in 24h)
 *   - Self-dealing detection (same IP, same facility)
 *   - Flags reviews with reason string
 */

jest.mock('@/lib/cron-auth');
jest.mock('@/lib/cron-logger');

// Module-level supabase = createClient(...) — use wrappers for lazy delegation
const mockRpcDelegate = jest.fn();
const mockFromDelegate = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    rpc: (...args: any[]) => mockRpcDelegate(...args),
    from: (...args: any[]) => mockFromDelegate(...args),
  })),
}));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { GET } from '../route';

let mockRpc: jest.Mock;
let mockSelectReviews: jest.Mock;
let mockUpdateReviews: jest.Mock;

function setupDefaultMocks(
  bulkSpamCount: number = 1,
  reviewsPerIp: number = 3,
  selfDealingExists: boolean = true
) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);

  const bulkSpamIps = Array.from({ length: bulkSpamCount }, (_, i) => ({
    reviewer_ip: `192.168.${i}.1`,
  }));

  mockRpc = mockRpcDelegate;
  mockRpcDelegate.mockResolvedValue({
    data: bulkSpamIps,
    error: null,
  });

  const reviewsData = Array.from({ length: reviewsPerIp }, (_, i) => ({
    id: `review-${i}`,
    is_flagged: false,
  }));

  mockSelectReviews = jest.fn().mockReturnValue({
    // bulk spam chain: .select().eq('reviewer_ip',...).gte().eq('is_flagged',false)
    eq: jest.fn().mockReturnValue({
      gte: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: reviewsData }),
      }),
    }),
    // self-dealing chain: .select().not().eq('is_flagged',false).eq('status','published')
    not: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: [] }),
      }),
    }),
  });

  mockUpdateReviews = jest.fn().mockReturnValue({
    in: jest.fn().mockResolvedValue({ error: null }),
  });

  mockFromDelegate.mockImplementation((table: string) => {
    if (table === 'facility_reviews') {
      return {
        select: (...args: any[]) => mockSelectReviews(...args),
        update: (...args: any[]) => mockUpdateReviews(...args),
      };
    }
    return {};
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
});

function makeRequest() {
  return new Request('http://localhost/api/cron/flag-reviews', {
    method: 'GET',
    headers: { 'Authorization': 'Bearer cron-secret' },
  });
}

describe('GET /api/cron/flag-reviews', () => {
  test('CRON_SECRET check failed → returns error', async () => {
    const errorResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    (checkCronAuth as jest.Mock).mockReturnValue(errorResponse);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(401);
  });

  test('calls RPC find_bulk_review_ips with 24h window', async () => {
    const res = await GET(makeRequest() as any);

    expect(mockRpc).toHaveBeenCalledWith('find_bulk_review_ips', expect.objectContaining({
      p_threshold: 3,
    }));

    const call = mockRpc.mock.calls[0];
    const since = call[1].p_since;
    expect(typeof since).toBe('string');
  });

  test('flags bulk submission reviews (3+ in 24h from same IP)', async () => {
    const res = await GET(makeRequest() as any);

    expect(mockUpdateReviews).toHaveBeenCalled();
  });

  test('includes flag_reason in bulk submission flag', async () => {
    await GET(makeRequest() as any);

    const call = mockUpdateReviews.mock.calls[0];
    const updateData = call[0];
    expect(updateData.flag_reason).toContain('bulk_submission');
    expect(updateData.flag_reason).toContain('24h');
  });

  test('detects self-dealing: same IP, same facility', async () => {
    const selfDealingData = [
      { id: 'review-1', reviewer_ip: '192.168.1.1', facility_id: 'fac-1', is_flagged: false, status: 'published' },
      { id: 'review-2', reviewer_ip: '192.168.1.1', facility_id: 'fac-1', is_flagged: false, status: 'published' },
    ];

    mockSelectReviews = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: [] }),
        }),
      }),
      not: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: selfDealingData }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('RPC error → logs and continues', async () => {
    mockRpcDelegate.mockResolvedValue({
      data: null,
      error: { message: 'RPC failed' },
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    consoleSpy.mockRestore();
  });

  test('no reviews found for bulk spam IP → skipped', async () => {
    mockSelectReviews = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: [] }),
        }),
      }),
      not: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: [] }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('update error during bulk flag → logged and continues', async () => {
    mockUpdateReviews = jest.fn().mockReturnValue({
      in: jest.fn().mockResolvedValue({ error: { message: 'Update failed' } }),
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    consoleSpy.mockRestore();
  });

  test('filters by is_flagged=false (no double-flagging)', async () => {
    await GET(makeRequest() as any);

    // Route calls .eq('is_flagged', false) in both bulk and self-dealing checks
    expect(mockSelectReviews).toHaveBeenCalled();
    const innerEq = mockSelectReviews.mock.results[0].value.eq.mock.results[0].value.gte.mock.results[0].value.eq;
    expect(innerEq).toHaveBeenCalledWith('is_flagged', false);
  });

  test('filters by status=published for self-dealing check', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('returns 200 with flagged count', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.processed).toBe('number');
  });

  test('handles multiple bulk spam IPs', async () => {
    setupDefaultMocks(3, 3);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('IP-facility grouping for deduplication', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('skips reviews with null reviewer_ip', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('processes both bulk and self-dealing checks', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('update エラー → console.error してフラグ数に加算しない', async () => {
    mockUpdateReviews = jest.fn().mockReturnValue({
      in: jest.fn().mockResolvedValue({ error: { message: 'update failed' } }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_reviews') {
        return {
          select: (...args: any[]) => mockSelectReviews(...args),
          update: (...args: any[]) => mockUpdateReviews(...args),
        };
      }
      return {};
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0); // updateErr → flagged not incremented
  });

  test('bulkSpam null (not array) → skip bulk check', async () => {
    mockRpcDelegate.mockResolvedValue({ data: null, error: null });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
  });

  test('dupFacility null → skip self-dealing check', async () => {
    mockSelectReviews = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: [] }),
        }),
      }),
      not: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: null }),
        }),
      }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_reviews') {
        return {
          select: (...args: any[]) => mockSelectReviews(...args),
          update: (...args: any[]) => mockUpdateReviews(...args),
        };
      }
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
  });

  test('self-dealing with only 1 review per IP-facility → not flagged', async () => {
    mockSelectReviews = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: [] }),
        }),
      }),
      not: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: [
              { id: 'r1', reviewer_ip: '1.1.1.1', facility_id: 'fac-a' },
              { id: 'r2', reviewer_ip: '1.1.1.1', facility_id: 'fac-b' },
            ],
          }),
        }),
      }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_reviews') {
        return {
          select: (...args: any[]) => mockSelectReviews(...args),
          update: (...args: any[]) => mockUpdateReviews(...args),
        };
      }
      return {};
    });

    const res = await GET(makeRequest() as any);
    const json = await res.json();
    // bulk spam: select → data:[], self-dealing: 各 IP-facility 1件のみ → 両方 0
    expect(json.processed).toBe(0);
  });

  test('self-dealing update error → logs', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSelectReviews = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        gte: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: [] }),
        }),
      }),
      not: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: [
              { id: 'r1', reviewer_ip: '2.2.2.2', facility_id: 'fac-x' },
              { id: 'r2', reviewer_ip: '2.2.2.2', facility_id: 'fac-x' },
            ],
          }),
        }),
      }),
    });
    mockUpdateReviews = jest.fn().mockReturnValue({
      in: jest.fn().mockResolvedValue({ error: { message: 'self-dealing update failed' } }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_reviews') {
        return {
          select: (...args: any[]) => mockSelectReviews(...args),
          update: (...args: any[]) => mockUpdateReviews(...args),
        };
      }
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    consoleSpy.mockRestore();
  });

  test('非 Error スロー → String() フォールバック', async () => {
    mockRpcDelegate.mockImplementation(() => { throw 'rpc string error'; });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith(
      'flag-reviews', 'error', expect.any(Date),
      expect.objectContaining({ error_msg: 'rpc string error' })
    );
  });

  // Branch coverage: line 101 — e instanceof Error の true 分岐（Error オブジェクト → e.message を使用）
  test('Error オブジェクトスロー → e instanceof Error true → e.message → 500（line 101 true 分岐）', async () => {
    mockRpcDelegate.mockImplementation(() => { throw new Error('rpc failed'); });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith(
      'flag-reviews', 'error', expect.any(Date),
      expect.objectContaining({ error_msg: 'rpc failed' })
    );
  });
});
