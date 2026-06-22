/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/hpb-menu-scrape
 *   - cron auth・facility 取得エラー→500・空リスト・集計・例外catch・時間予算で繰延
 */

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn(() => null) }));
jest.mock('@/lib/cron-logger', () => ({ logCronRun: jest.fn() }));
jest.mock('@/lib/hpb-menu', () => ({ scrapeAndSaveFacility: jest.fn() }));

const mockAdminFrom = jest.fn();
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { GET } from '../route';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { scrapeAndSaveFacility } from '@/lib/hpb-menu';

function req() {
  return new Request('http://localhost/api/cron/hpb-menu-scrape', {
    headers: { authorization: 'Bearer x' },
  });
}

// admin.from('facility_profiles') は 2 用途で使われる:
//  1. rotation 取得: .select().not().order().limit()
//  2. 処理ごとの stamp: .update().eq()  (hpb_scraped_at ローテ前進)
// 同じ返却オブジェクトで両方をサポートする。stampError を渡すと update().eq() が error を返す。
function facChain(data: unknown, error: unknown = null, stampError: unknown = null) {
  return {
    select: jest.fn().mockReturnValue({
      not: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({ data, error }),
        }),
      }),
    }),
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: stampError }),
    }),
  };
}

const okResult = { slnId: 'H1', fetched: 5, ok: 4, skipped: 1, failed: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

test('cron auth NG → そのレスポンスを返す', async () => {
  (checkCronAuth as jest.Mock).mockReturnValue(
    new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
  );
  expect((await GET(req())).status).toBe(401);
});

test('facility 取得エラー → 500 + logCronRun(error)', async () => {
  mockAdminFrom.mockReturnValue(facChain(null, { message: 'db' }));
  const res = await GET(req());
  expect(res.status).toBe(500);
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('error');
});

test('空リスト(data null) → 集計ゼロで success', async () => {
  mockAdminFrom.mockReturnValue(facChain(null));
  const res = await GET(req());
  const json = await res.json();
  expect(json).toEqual({ facilities: 0, saved: 0, skipped: 0, failed: 0, deferred: 0, zeroFetch: 0 });
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('success');
});

test('複数施設を集計', async () => {
  mockAdminFrom.mockReturnValue(facChain([{ id: 'f1' }, { id: 'f2' }]));
  (scrapeAndSaveFacility as jest.Mock).mockResolvedValue(okResult);
  const res = await GET(req());
  const json = await res.json();
  expect(json).toEqual({ facilities: 2, saved: 8, skipped: 2, failed: 0, deferred: 0, zeroFetch: 0 });
});

test('設定済み(slnIdあり)で0件取得 → zeroFetch++ (HPB構造変化/ID誤りの発症前検知)', async () => {
  mockAdminFrom.mockReturnValue(facChain([{ id: 'f1' }]));
  (scrapeAndSaveFacility as jest.Mock).mockResolvedValue({ slnId: 'H1', fetched: 0, ok: 0, skipped: 0, failed: 0 });
  const json = await (await GET(req())).json();
  expect(json.zeroFetch).toBe(1);
  // logCronRun の meta にも zeroFetch が出る
  const logArg = (logCronRun as jest.Mock).mock.calls[0][3];
  expect(logArg.meta.zeroFetch).toBe(1);
});

test('slnId 未解決(null)の0件は zeroFetch に数えない (&& 短絡)', async () => {
  mockAdminFrom.mockReturnValue(facChain([{ id: 'f1' }]));
  (scrapeAndSaveFacility as jest.Mock).mockResolvedValue({ slnId: null, fetched: 0, ok: 0, skipped: 0, failed: 0 });
  const json = await (await GET(req())).json();
  expect(json.zeroFetch).toBe(0);
});

test('施設のscrape例外 → catchでfailed++', async () => {
  mockAdminFrom.mockReturnValue(facChain([{ id: 'f1' }]));
  (scrapeAndSaveFacility as jest.Mock).mockRejectedValue(new Error('boom'));
  const res = await GET(req());
  const json = await res.json();
  expect(json.failed).toBe(1);
  expect(json.facilities).toBe(0);
});

test('例外が Error 以外(string) でも String() で処理', async () => {
  mockAdminFrom.mockReturnValue(facChain([{ id: 'f1' }]));
  (scrapeAndSaveFacility as jest.Mock).mockRejectedValue('str-error');
  const res = await GET(req());
  expect((await res.json()).failed).toBe(1);
});

test('hpb_scraped_at stamp 失敗 → failed++ (rotation 前進不能の可視化)', async () => {
  // scrape は成功(failed=0)だが stamp(update().eq())が error → failed=1 になる。
  mockAdminFrom.mockReturnValue(facChain([{ id: 'f1' }], null, { message: 'stamp-db' }));
  (scrapeAndSaveFacility as jest.Mock).mockResolvedValue(okResult);
  const json = await (await GET(req())).json();
  expect(json.facilities).toBe(1);
  expect(json.failed).toBe(1);
});

test('時間予算超過 → 残りを deferred', async () => {
  mockAdminFrom.mockReturnValue(facChain([{ id: 'f1' }, { id: 'f2' }]));
  (scrapeAndSaveFacility as jest.Mock).mockResolvedValue(okResult);
  // loopStart=0, i=0 check=0(未超過→処理), i=1 check=1e9(超過→繰延)
  const spy = jest
    .spyOn(Date, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(1_000_000_000);
  const res = await GET(req());
  const json = await res.json();
  expect(json.facilities).toBe(1);
  expect(json.deferred).toBe(1);
  spy.mockRestore();
});
