/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/hpb-menu-scrape
 *   - cron auth・facility 取得エラー→500・空リスト・集計・例外catch・時間予算で繰延
 */

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn(() => null) }));
jest.mock('@/lib/cron-logger', () => {
  const logCronRun = jest.fn();
  const cronError = jest.fn(async (
    jobName: string,
    startedAt: Date,
    cause: unknown,
    opts: { message?: string; extraLog?: Record<string, unknown>; extraBody?: Record<string, unknown> } = {},
  ) => {
    const error_msg = cause instanceof Error
      ? cause.message
      : (cause && typeof cause === 'object' && 'message' in cause && typeof (cause as any).message === 'string')
        ? (cause as any).message
        : String(cause);
    await logCronRun(jobName, 'error', startedAt, { error_msg, ...opts.extraLog });
    return {
      status: 500,
      json: async () => ({ error: opts.message ?? 'Internal error', ...opts.extraBody }),
    };
  });
  return { logCronRun, cronError };
});
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
  expect((logCronRun as jest.Mock).mock.calls[0][3].meta.stages).toEqual({
    facilityList: 'error',
    hpbFetch: 'not_started',
    dbSave: 'not_started',
    completion: 'error',
  });
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
  const res = await GET(req());
  const json = await res.json();
  expect(res.status).toBe(500);
  expect(json.facilities).toBe(1);
  expect(json.failed).toBe(1);
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('error');
  expect((logCronRun as jest.Mock).mock.calls[0][3].meta.stages.dbSave).toBe('partial_failure');
});

test('時間予算超過のみ → 残りを deferred として成功記録', async () => {
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
  expect(res.status).toBe(200);
  expect(json.facilities).toBe(1);
  expect(json.deferred).toBe(1);
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('success');
  expect((logCronRun as jest.Mock).mock.calls[0][3].meta.stages.completion).toBe('deferred');
  spy.mockRestore();
});

// C-3 根治: 全件失敗（例外経路）は成功に倒さず、cronError の単一通知へ集約する。
// 旧実装は catch 経路だと
// results.facilities が加算されないため「全件失敗」の分母が 0 になり判定不能だった
// （分母を試行件数 list.length - deferred に修正した回帰テスト）。
test('全件が例外で失敗(facilities加算なし) → attempted基準でallFailed判定し単一error記録', async () => {
  mockAdminFrom.mockReturnValue(facChain([{ id: 'f1' }, { id: 'f2' }]));
  (scrapeAndSaveFacility as jest.Mock).mockRejectedValue(new Error('boom'));
  const res = await GET(req());
  const json = await res.json();
  expect(res.status).toBe(500);
  expect(json.facilities).toBe(0);
  expect(json.failed).toBe(2);
  expect((logCronRun as jest.Mock).mock.calls).toHaveLength(1);
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('error');
  expect((logCronRun as jest.Mock).mock.calls[0][3].error_msg).toContain('all attempted facilities');
});

// 全件0件取得(zeroFetch全滅)は allFailed と区別した理由で単一error記録する。
test('全件0件取得(zeroFetch全滅) → 単一error記録に理由を含める', async () => {
  mockAdminFrom.mockReturnValue(facChain([{ id: 'f1' }]));
  (scrapeAndSaveFacility as jest.Mock).mockResolvedValue({ slnId: 'H1', fetched: 0, ok: 0, skipped: 0, failed: 0 });
  const res = await GET(req());
  expect(res.status).toBe(500);
  expect((logCronRun as jest.Mock).mock.calls).toHaveLength(1);
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('error');
  expect((logCronRun as jest.Mock).mock.calls[0][3].error_msg).toContain('zero menus');
});

// 部分失敗（1件でも成功がある）は run 全体の成功に倒さない。
test('部分失敗（一部成功） → 500 + logCronRun(error), success記録なし', async () => {
  mockAdminFrom.mockReturnValue(facChain([{ id: 'f1' }, { id: 'f2' }]));
  let callCount = 0;
  (scrapeAndSaveFacility as jest.Mock).mockImplementation(() => {
    callCount++;
    return callCount === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(okResult);
  });
  const res = await GET(req());
  expect(res.status).toBe(500);
  expect((logCronRun as jest.Mock).mock.calls).toHaveLength(1);
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('error');
  expect((logCronRun as jest.Mock).mock.calls[0][3].meta.stages).toEqual(expect.objectContaining({
    hpbFetch: 'partial_failure',
    completion: 'error',
  }));
});

test('HPB取得後のDB保存失敗 → 500 + error記録（成功cronにしない）', async () => {
  mockAdminFrom.mockReturnValue(facChain([{ id: 'f1' }]));
  (scrapeAndSaveFacility as jest.Mock).mockResolvedValue({
    slnId: 'H1', fetched: 2, ok: 0, skipped: 0, failed: 2,
  });

  const res = await GET(req());
  expect(res.status).toBe(500);
  expect((logCronRun as jest.Mock).mock.calls).toHaveLength(1);
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('error');
  const meta = (logCronRun as jest.Mock).mock.calls[0][3].meta;
  expect(meta.stages).toEqual(expect.objectContaining({ dbSave: 'partial_failure', completion: 'error' }));
  expect(meta.hpbFetched).toBe(2);
  expect(meta.dbSaveFailed).toBe(2);
});

test('行保存失敗1施設＋正常skipped 1施設 → 全滅とは記録しない', async () => {
  mockAdminFrom.mockReturnValue(facChain([{ id: 'f1' }, { id: 'f2' }]));
  let callCount = 0;
  (scrapeAndSaveFacility as jest.Mock).mockImplementation(() => {
    callCount++;
    return callCount === 1
      ? Promise.resolve({ slnId: 'H1', fetched: 2, ok: 0, skipped: 0, failed: 2 })
      : Promise.resolve({ slnId: 'H2', fetched: 2, ok: 0, skipped: 2, failed: 0 });
  });

  const res = await GET(req());
  expect(res.status).toBe(500);
  const logArg = (logCronRun as jest.Mock).mock.calls[0][3];
  expect(logArg.error_msg).toContain('partially failed');
  expect(logArg.meta.allFailed).toBe(false);
  expect(logArg.meta.facilityFailed).toBe(1);
  expect(logArg.meta.dbSaveFailed).toBe(2);
});

test('同一施設の行保存失敗＋stamp失敗は1施設として数え、正常施設があれば全滅とは記録しない', async () => {
  const chain = facChain([{ id: 'f1' }, { id: 'f2' }]);
  let stampCount = 0;
  chain.update = jest.fn().mockReturnValue({
    eq: jest.fn().mockImplementation(async () => ({
      error: stampCount++ === 0 ? { message: 'stamp-db' } : null,
    })),
  });
  mockAdminFrom.mockReturnValue(chain);
  let scrapeCount = 0;
  (scrapeAndSaveFacility as jest.Mock).mockImplementation(() => {
    scrapeCount++;
    return scrapeCount === 1
      ? Promise.resolve({ slnId: 'H1', fetched: 2, ok: 0, skipped: 0, failed: 2 })
      : Promise.resolve({ slnId: 'H2', fetched: 2, ok: 0, skipped: 2, failed: 0 });
  });

  const res = await GET(req());
  expect(res.status).toBe(500);
  const logArg = (logCronRun as jest.Mock).mock.calls[0][3];
  expect(logArg.error_msg).toContain('partially failed');
  expect(logArg.meta.allFailed).toBe(false);
  expect(logArg.meta.facilityFailed).toBe(1);
  expect(logArg.meta.dbSaveFailed).toBe(2);
  expect(logArg.meta.stampFailed).toBe(1);
});

test('deferred + 施設失敗 → deferredを保持したerror記録（成功に倒さない）', async () => {
  mockAdminFrom.mockReturnValue(facChain([{ id: 'f1' }, { id: 'f2' }]));
  (scrapeAndSaveFacility as jest.Mock).mockRejectedValue(new Error('boom'));
  const spy = jest
    .spyOn(Date, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(1_000_000_000);

  const res = await GET(req());
  expect(res.status).toBe(500);
  const json = await res.json();
  expect(json.failed).toBe(1);
  expect(json.deferred).toBe(1);
  expect((logCronRun as jest.Mock).mock.calls).toHaveLength(1);
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('error');
  expect((logCronRun as jest.Mock).mock.calls[0][3].meta.stages.completion).toBe('error');
  spy.mockRestore();
});
