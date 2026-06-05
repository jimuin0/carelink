/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/publish-scheduled-blog
 * 予約ブログ公開の ISR 再検証 cron。直近に scheduled_at が到来した施設ブログを on-demand 再検証する。
 */

jest.mock('@/lib/cron-auth');
jest.mock('@/lib/cron-logger');
jest.mock('@/lib/revalidate', () => ({ revalidateFacilityBlog: jest.fn() }));

const mockFromDelegate = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (...args: any[]) => mockFromDelegate(...args),
  })),
}));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { revalidateFacilityBlog } from '@/lib/revalidate';
import { GET } from '../route';

// blog_posts の .range() が返す {data, error}
let mockBlogRange: jest.Mock;
// facility_profiles の .in() が返す {data}
let facsResult: { data: unknown };

function setupMocks() {
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);

  mockBlogRange = jest.fn().mockResolvedValue({ data: [], error: null });
  facsResult = { data: [] };

  mockFromDelegate.mockImplementation((table: string) => {
    if (table === 'blog_posts') {
      return {
        select: () => ({
          eq: () => ({
            gte: () => ({
              lte: () => ({ range: (...a: any[]) => mockBlogRange(...a) }),
            }),
          }),
        }),
      };
    }
    if (table === 'facility_profiles') {
      return { select: () => ({ in: () => Promise.resolve(facsResult) }) };
    }
    return {};
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  setupMocks();
});

function makeRequest() {
  return new Request('http://localhost/api/cron/publish-scheduled-blog', {
    method: 'GET',
    headers: { Authorization: 'Bearer cron-secret' },
  });
}

describe('GET /api/cron/publish-scheduled-blog', () => {
  test('認証失敗 → そのまま返す', async () => {
    const unauth = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    (checkCronAuth as jest.Mock).mockReturnValue(unauth);

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
    expect(mockFromDelegate).not.toHaveBeenCalled();
  });

  test('scheduled_at 列が無い(42703) → skipped・revalidated 0', async () => {
    mockBlogRange.mockResolvedValue({ data: null, error: { code: '42703', message: 'column "scheduled_at" does not exist' } });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.revalidated).toBe(0);
    expect(json.reason).toBe('scheduled_at column absent');
    expect(logCronRun).toHaveBeenCalledWith('publish-scheduled-blog', 'skipped', expect.any(Date), expect.objectContaining({ processed: 0 }));
    expect(revalidateFacilityBlog).not.toHaveBeenCalled();
  });

  test('一般的なクエリエラー → 500', async () => {
    mockBlogRange.mockResolvedValue({ data: null, error: { code: 'XX500', message: 'boom' } });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith('publish-scheduled-blog', 'error', expect.any(Date), expect.objectContaining({ error_msg: expect.any(String) }));
  });

  test('対象投稿なし → skipped・revalidated 0', async () => {
    mockBlogRange.mockResolvedValue({ data: [], error: null });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.revalidated).toBe(0);
    expect(revalidateFacilityBlog).not.toHaveBeenCalled();
  });

  test('対象投稿あり → 施設slug解決して再検証（重複施設は1回・null施設IDは除外・slug nullはカウントしない）', async () => {
    mockBlogRange.mockResolvedValue({
      data: [
        { facility_id: 'f1', scheduled_at: '2026-06-04T09:00:00Z' },
        { facility_id: 'f1', scheduled_at: '2026-06-04T09:30:00Z' },
        { facility_id: 'f2', scheduled_at: '2026-06-04T09:45:00Z' },
        { facility_id: null, scheduled_at: '2026-06-04T09:50:00Z' },
      ],
      error: null,
    });
    facsResult = { data: [{ id: 'f1', slug: 'salon-1' }, { id: 'f2', slug: null }] };

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    // salon-1 のみカウント（f2 は slug null）
    expect(json.revalidated).toBe(1);
    expect(revalidateFacilityBlog).toHaveBeenCalledWith('salon-1');
    expect(revalidateFacilityBlog).toHaveBeenCalledWith(null);
    expect(logCronRun).toHaveBeenCalledWith('publish-scheduled-blog', 'success', expect.any(Date), expect.objectContaining({ processed: 1 }));
  });

  test('facility_profiles が data null → 再検証0・success', async () => {
    mockBlogRange.mockResolvedValue({ data: [{ facility_id: 'f1', scheduled_at: '2026-06-04T09:00:00Z' }], error: null });
    facsResult = { data: null };

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.revalidated).toBe(0);
    expect(revalidateFacilityBlog).not.toHaveBeenCalled();
  });

  test('クエリエラーが Error インスタンス → 500（error.message 経路）', async () => {
    mockBlogRange.mockResolvedValue({ data: null, error: new Error('boom-error-instance') });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith('publish-scheduled-blog', 'error', expect.any(Date), expect.objectContaining({ error_msg: 'boom-error-instance' }));
  });

  test('range が throw → catch で 500（Error インスタンス）', async () => {
    mockBlogRange.mockRejectedValue(new Error('connection refused'));

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith('publish-scheduled-blog', 'error', expect.any(Date), expect.objectContaining({ error_msg: expect.any(String) }));
  });

  test('range が非Errorで throw → catch で 500（String(e) 経路）', async () => {
    mockBlogRange.mockRejectedValue('string-rejection');

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith('publish-scheduled-blog', 'error', expect.any(Date), expect.objectContaining({ error_msg: 'string-rejection' }));
  });
});
