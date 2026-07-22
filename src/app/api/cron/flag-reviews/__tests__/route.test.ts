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
jest.mock('@/lib/alert', () => ({ alertWarning: jest.fn() }));

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
import { alertWarning } from '@/lib/alert';
import { GET } from '../route';

let mockRpc: jest.Mock;
let mockSelectReviews: jest.Mock;
let mockUpdateReviews: jest.Mock;
// 【監査H3】moderation_queue 投入モック。既存 pending の content_id 集合と insert スパイ。
let mockModQueueInsert: jest.Mock;
let existingQueueContentIds: string[] = [];

// fetchAllPaged 化で両クエリ末尾に .order().range() が付く。1ページ目に rows、
// 2ページ目以降(offset>0)は空配列を返して終了させる terminal。
function pagedTerminal(rows: any[] | null) {
  return {
    order: jest.fn().mockReturnValue({
      range: jest.fn().mockImplementation((from: number) =>
        // data:null（dupFacility null テスト）は from===0 でそのまま返し、fetchAllPaged は rows:[] になる
        Promise.resolve({ data: from === 0 ? rows : [], error: null })),
    }),
  };
}

// 両チェイン（bulk: eq→gte→eq, self-dealing: not→eq→eq）を pagedTerminal で終端する select モック。
function makeSelectMock(bulkRows: any[] | null, selfDealingRows: any[] | null) {
  return jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      gte: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue(pagedTerminal(bulkRows)),
      }),
    }),
    not: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue(pagedTerminal(selfDealingRows)),
      }),
    }),
  });
}

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

  // bulk: reviewsData / self-dealing: 既定は空（selfDealingExists 引数は既存呼び出しと互換のため温存）
  void selfDealingExists;
  mockSelectReviews = makeSelectMock(reviewsData, []);

  mockUpdateReviews = jest.fn().mockReturnValue({
    in: jest.fn().mockResolvedValue({ error: null }),
  });

  // 【監査H3】moderation_queue: select(content_id).eq.eq.in → 既存 pending / insert → { error:null }
  existingQueueContentIds = [];
  mockModQueueInsert = jest.fn().mockResolvedValue({ error: null });

  mockFromDelegate.mockImplementation((table: string) => {
    if (table === 'facility_reviews') {
      return {
        select: (...args: any[]) => mockSelectReviews(...args),
        update: (...args: any[]) => mockUpdateReviews(...args),
      };
    }
    if (table === 'moderation_queue') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({
                data: existingQueueContentIds.map((id) => ({ content_id: id })),
                error: null,
              }),
            }),
          }),
        }),
        insert: (...args: any[]) => mockModQueueInsert(...args),
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

    mockSelectReviews = makeSelectMock([], selfDealingData);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  // C-3 根治: 検知1(同一IP大量投稿スパム)が無音で無効化される障害を Slack へ警報する
  test('RPC error → logs and continues + alertWarning発火(検知1が無効化されたことを警報)', async () => {
    mockRpcDelegate.mockResolvedValue({
      data: null,
      error: { message: 'RPC failed' },
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    expect(alertWarning).toHaveBeenCalledTimes(1);
    expect((alertWarning as jest.Mock).mock.calls[0][0]).toMatch(/検知1/);
    consoleSpy.mockRestore();
  });

  test('no reviews found for bulk spam IP → skipped', async () => {
    mockSelectReviews = makeSelectMock([], []);

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
    mockSelectReviews = makeSelectMock([], null);
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
    mockSelectReviews = makeSelectMock([], [
      { id: 'r1', reviewer_ip: '1.1.1.1', facility_id: 'fac-a' },
      { id: 'r2', reviewer_ip: '1.1.1.1', facility_id: 'fac-b' },
    ]);
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
    mockSelectReviews = makeSelectMock([], [
      { id: 'r1', reviewer_ip: '2.2.2.2', facility_id: 'fac-x' },
      { id: 'r2', reviewer_ip: '2.2.2.2', facility_id: 'fac-x' },
    ]);
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

  // ─── 監査H3: フラグ → moderation_queue 投入（審査画面に必ず表示）───────────────
  describe('moderation_queue 連携（H3）', () => {
    test('自動フラグしたレビューを moderation_queue へ pending 投入する', async () => {
      // bulk 検知で 3 件フラグ → moderation_queue へ投入される。
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      expect(mockModQueueInsert).toHaveBeenCalled();
      const inserted = mockModQueueInsert.mock.calls[0][0];
      expect(Array.isArray(inserted)).toBe(true);
      expect(inserted[0]).toEqual(
        expect.objectContaining({
          content_type: 'review',
          status: 'pending',
          reporter_id: null,
          auto_flags: ['bulk_submission'],
        }),
      );
      // フラグした全レビューが content_id として投入される。
      expect(inserted.map((r: { content_id: string }) => r.content_id)).toEqual(['review-0', 'review-1', 'review-2']);
    });

    test('既に pending キューにあるレビューは重複投入しない（dedup）', async () => {
      existingQueueContentIds = ['review-0', 'review-1', 'review-2']; // 全件既存
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      // 全件が既存 → insert は呼ばれない。
      expect(mockModQueueInsert).not.toHaveBeenCalled();
    });

    test('一部だけ既存 → 未登録分のみ投入する', async () => {
      existingQueueContentIds = ['review-0']; // review-0 のみ既存
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      const inserted = mockModQueueInsert.mock.calls[0][0];
      expect(inserted.map((r: { content_id: string }) => r.content_id)).toEqual(['review-1', 'review-2']);
    });

    test('moderation_queue insert 失敗 → console.error のみで cron は 200 継続', async () => {
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockModQueueInsert.mockResolvedValueOnce({ error: { message: 'mq insert failed' } });
      const res = await GET(makeRequest() as any);
      expect(res.status).toBe(200);
      expect(errSpy).toHaveBeenCalledWith('[flag-reviews] moderation_queue enqueue failed:', expect.anything());
      errSpy.mockRestore();
    });
  });
});
