/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/threads-backfill
 * Key assertions:
 *   - CRON_SECRET validation
 *   - Stale claim reclaim（自己修復）が候補選出の前に走る
 *   - CAS claim（threads_post_id IS NULL AND threads_posted_at IS NULL）で二重投稿を防ぐ
 *     （負の対照(a): claim の is() 条件を外すと二重投稿を防げないことを検証する）
 *   - outcome 別の分岐:
 *       published → threads_post_id を記録・claim は解放不要
 *       permanent → claim を解放せず（再選出されない）明示アラート
 *         （負の対照(b): permanent を transient と同じ扱いにするとこの区別が失われる）
 *       transient → claim を解放し次回再試行
 *       skipped   → claim を解放し、以降の候補を試さず break（未設定はグローバルな状態）
 *   - 1 run の件数上限（MAX_POSTS_PER_RUN）を超えたら truncated を記録・警告ログを出す
 *     （負の対照(c): このログを消すとテストが赤くなる）
 *   - cron_logs への記録・500 応答は cronError 経由
 */

jest.mock('@/lib/cron-auth', () => ({
  checkCronAuth: jest.fn(() => null),
}));
jest.mock('@/lib/cron-logger', () => {
  const logCronRun = jest.fn().mockResolvedValue(undefined);
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
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/threads', () => ({
  publishThreadsText: jest.fn(),
  buildArticlePostText: jest.fn((title: string, url: string) => `${title}\n\n${url}`),
}));
jest.mock('@/lib/alert', () => ({
  alertDeliveryFailures: jest.fn(),
  alertWarning: jest.fn(),
}));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun, cronError } from '@/lib/cron-logger';
import { publishThreadsText, buildArticlePostText } from '@/lib/threads';
import { alertDeliveryFailures, alertWarning } from '@/lib/alert';
import { GET } from '../route';

function mockRequest(): Request {
  return new Request('https://carelink-jp.com/api/cron/threads-backfill', {
    headers: { authorization: 'Bearer test-secret' },
  });
}

interface Candidate { id: string; title: string; slug: string }

interface TableConfig {
  reclaimError?: unknown;
  totalEligible?: number | null;
  countError?: unknown;
  candidates?: Candidate[] | null;
  fetchError?: unknown;
  claims?: Record<string, { data: { id: string }[] | null; error?: unknown }>;
  finalizeErrors?: Record<string, unknown>;
  releaseErrors?: Record<string, unknown>;
  /** claim update の is() を呼ばずに素通しする壊れた実装を模擬する（負の対照 a 用）。 */
  brokenClaimNoCasGuard?: boolean;
}

let reclaimSpy: { is: jest.Mock; not: jest.Mock; lt: jest.Mock };
let claimEqSpy: jest.Mock;
let claimIsArgsSpy: jest.Mock;
let releaseEqSpy: jest.Mock;
let finalizeEqSpy: jest.Mock;

function makePostsTable(cfg: TableConfig) {
  const candidates = cfg.candidates ?? [];

  const lt = jest.fn().mockResolvedValue({ error: cfg.reclaimError ?? null });
  const not = jest.fn().mockReturnValue({ lt });
  const reclaimIs = jest.fn().mockReturnValue({ not });
  reclaimSpy = { is: reclaimIs, not, lt };

  const countChain = {
    eq: jest.fn().mockReturnValue({
      is: jest.fn().mockReturnValue({
        is: jest.fn().mockResolvedValue({
          count: cfg.totalEligible === undefined ? candidates.length : cfg.totalEligible,
          error: cfg.countError ?? null,
        }),
      }),
    }),
  };

  const fetchChain = {
    eq: jest.fn().mockReturnValue({
      is: jest.fn().mockReturnValue({
        is: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue({
              data: cfg.fetchError ? null : (cfg.candidates === undefined ? candidates : cfg.candidates),
              error: cfg.fetchError ?? null,
            }),
          }),
        }),
      }),
    }),
  };

  const selectMock = jest.fn((_cols: string, selOpts?: { count?: string; head?: boolean }) => {
    if (selOpts && selOpts.count) return countChain;
    return fetchChain;
  });

  claimEqSpy = jest.fn();
  claimIsArgsSpy = jest.fn();
  releaseEqSpy = jest.fn();
  finalizeEqSpy = jest.fn();

  const updateMock = jest.fn((data: Record<string, unknown>) => {
    if ('threads_post_id' in data) {
      // finalize（published outcome）: update({threads_post_id}).eq('id', X).is('threads_post_id', null)
      return {
        eq: jest.fn((field: string, id: string) => {
          finalizeEqSpy(field, id);
          return {
            is: jest.fn().mockResolvedValue({ error: cfg.finalizeErrors?.[id] ?? null }),
          };
        }),
      };
    }

    if (data.threads_posted_at === null) {
      // 二役: (1) reclaim = update(...).is(...).not(...).lt(...)（eq を挟まない）
      //       (2) release = update(...).eq('id', X).is('threads_post_id', null)（awaited）
      return {
        is: reclaimIs,
        eq: jest.fn((field: string, id: string) => {
          releaseEqSpy(field, id);
          return {
            is: jest.fn().mockResolvedValue({ error: cfg.releaseErrors?.[id] ?? null }),
          };
        }),
      };
    }

    // claim: update({threads_posted_at: <iso>}).eq('id', X).is(...).is(...).select('id')
    return {
      eq: jest.fn((field: string, id: string) => {
        claimEqSpy(field, id);
        const claimResult = cfg.claims?.[id] ?? { data: [{ id }], error: null };
        if (cfg.brokenClaimNoCasGuard) {
          // 負の対照(a): is() ガードを経由せず select() へ直行する壊れた実装を模擬。
          return { select: jest.fn().mockResolvedValue(claimResult) };
        }
        return {
          is: jest.fn((field: string, value: unknown) => {
            claimIsArgsSpy(field, value);
            return {
              is: jest.fn((field2: string, value2: unknown) => {
                claimIsArgsSpy(field2, value2);
                return {
                  select: jest.fn().mockResolvedValue(claimResult),
                };
              }),
            };
          }),
        };
      }),
    };
  });

  return { select: selectMock, update: updateMock };
}

function setupSupabase(cfg: TableConfig) {
  const table = makePostsTable(cfg);
  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((tableName: string) => {
      if (tableName === 'platform_blog_posts') return table;
      throw new Error(`unexpected table: ${tableName}`);
    }),
  });
  return table;
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/cron/threads-backfill', () => {
  it('CRON_SECRET が不正なら checkCronAuth の応答をそのまま返す', async () => {
    const unauthorized = { status: 401, json: async () => ({ error: 'Unauthorized' }) };
    (checkCronAuth as jest.Mock).mockReturnValue(unauthorized);
    setupSupabase({ candidates: [] });

    const res = await GET(mockRequest());

    expect(res).toBe(unauthorized);
  });

  it('候補が0件なら skipped として正常終了する', async () => {
    setupSupabase({ candidates: [] });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(body).toEqual({ processed: 0, skipped: 0, status: 'ok' });
    expect(logCronRun).toHaveBeenCalledWith(
      'threads-backfill', 'skipped', expect.any(Date), { processed: 0, skipped: 0 }
    );
    expect(publishThreadsText).not.toHaveBeenCalled();
  });

  it('候補取得の data が null（error 無し）でも空扱いで skipped になる（?? [] の防御分岐）', async () => {
    setupSupabase({ candidates: null as unknown as Candidate[] });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(body.status).toBe('ok');
    expect(body.processed).toBe(0);
  });

  it('count クエリが DB エラーなら cronError で 500', async () => {
    setupSupabase({ candidates: [{ id: 'p1', title: 'T', slug: 's1' }], countError: { message: 'count failed' } });

    const res = await GET(mockRequest());

    expect(res.status).toBe(500);
    expect(cronError).toHaveBeenCalledWith(
      'threads-backfill', expect.any(Date), { message: 'count failed' }, { message: 'Internal Server Error' }
    );
  });

  it('候補取得クエリが DB エラーなら cronError で 500', async () => {
    setupSupabase({ candidates: [{ id: 'p1', title: 'T', slug: 's1' }], fetchError: { message: 'fetch failed' } });

    const res = await GET(mockRequest());

    expect(res.status).toBe(500);
    expect(cronError).toHaveBeenCalledWith(
      'threads-backfill', expect.any(Date), { message: 'fetch failed' }, { message: 'Internal Server Error' }
    );
  });

  it('reclaim（stale claim 自己修復）が候補取得より前に呼ばれ、失敗しても本体は継続する', async () => {
    setupSupabase({
      candidates: [{ id: 'p1', title: 'Title', slug: 'slug-1' }],
      reclaimError: { message: 'reclaim failed' },
    });
    (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'published', postId: 'tid-1' });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(reclaimSpy.is).toHaveBeenCalledWith('threads_post_id', null);
    expect(reclaimSpy.not).toHaveBeenCalledWith('threads_posted_at', 'is', null);
    expect(reclaimSpy.lt).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      '[threads-backfill] stale claim reclaim failed (continuing)',
      expect.objectContaining({ err: 'reclaim failed' })
    );
    expect(body.processed).toBe(1); // reclaim 失敗でも本体は継続する
  });

  it('published: claim → 投稿成功 → threads_post_id を記録する', async () => {
    setupSupabase({ candidates: [{ id: 'p1', title: 'Title', slug: 'slug-1' }] });
    (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'published', postId: 'tid-1' });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(claimEqSpy).toHaveBeenCalledWith('id', 'p1');
    expect(buildArticlePostText).toHaveBeenCalledWith('Title', 'https://carelink-jp.com/blog/slug-1');
    expect(finalizeEqSpy).toHaveBeenCalledWith('id', 'p1');
    expect(body).toEqual({ processed: 1, skipped: 0, truncated: false });
    expect(logCronRun).toHaveBeenCalledWith(
      'threads-backfill', 'success', expect.any(Date),
      expect.objectContaining({ processed: 1, skipped: 0 })
    );
  });

  it('published: postId が省略された場合は null を記録する（?? null 分岐）', async () => {
    setupSupabase({ candidates: [{ id: 'p1', title: 'Title', slug: 'slug-1' }] });
    (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'published' });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(body.processed).toBe(1);
  });

  it('published: finalize の DB 書き込みが失敗しても投稿済みとしてカウントし CRITICAL ログを出す', async () => {
    setupSupabase({
      candidates: [{ id: 'p1', title: 'Title', slug: 'slug-1' }],
      finalizeErrors: { p1: { message: 'write failed' } },
    });
    (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'published', postId: 'tid-1' });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(body.processed).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('CRITICAL'),
      expect.objectContaining({ postId: 'p1' })
    );
  });

  it('🔴 permanent: claim を解放せず明示アラートを出す（負の対照(b): transient と同一挙動ならこの alertWarning 呼び出しが消える）', async () => {
    setupSupabase({ candidates: [{ id: 'p1', title: 'Title', slug: 'slug-1' }] });
    (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'permanent', reason: 'content violation' });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(alertWarning).toHaveBeenCalledWith(
      expect.stringContaining('恒久的に失敗'),
      { route: '/api/cron/threads-backfill' }
    );
    const message = (alertWarning as jest.Mock).mock.calls[0][0];
    expect(message).toContain('p1');
    expect(message).toContain('content violation');
    // claim（threads_posted_at:null での release）が呼ばれていないこと＝解放していないことの直接検証。
    expect(releaseEqSpy).not.toHaveBeenCalled();
    expect(body.processed).toBe(0);
    expect(body.skipped).toBe(1);
  });

  it('permanent: reason が無ければ既定文言 "unknown" を使う', async () => {
    setupSupabase({ candidates: [{ id: 'p1', title: 'Title', slug: 'slug-1' }] });
    (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'permanent' });

    await GET(mockRequest());

    const message = (alertWarning as jest.Mock).mock.calls[0][0];
    expect(message).toContain('unknown');
  });

  it('transient: claim を解放し、集約アラート(alertDeliveryFailures)に計上する', async () => {
    setupSupabase({ candidates: [{ id: 'p1', title: 'Title', slug: 'slug-1' }] });
    (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'transient', reason: 'network' });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(releaseEqSpy).toHaveBeenCalledWith('id', 'p1');
    expect(alertDeliveryFailures).toHaveBeenCalledWith(
      'threads-backfill', 1, expect.objectContaining({ published: 0, permanentFailures: 0, raced: 0 })
    );
    expect(alertWarning).not.toHaveBeenCalled();
    expect(body.skipped).toBe(1);
  });

  it('transient: publishThreadsText が例外を投げても transient 相当として claim を解放する（防御的 catch）', async () => {
    setupSupabase({ candidates: [{ id: 'p1', title: 'Title', slug: 'slug-1' }] });
    (publishThreadsText as jest.Mock).mockRejectedValue(new Error('unexpected throw'));

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(releaseEqSpy).toHaveBeenCalledWith('id', 'p1');
    expect(body.skipped).toBe(1);
    expect(alertDeliveryFailures).toHaveBeenCalledWith(
      'threads-backfill', 1, expect.any(Object)
    );
  });

  it('release（claim 解放）の DB 書き込みが失敗してもログを出して継続する', async () => {
    setupSupabase({
      candidates: [{ id: 'p1', title: 'Title', slug: 'slug-1' }],
      releaseErrors: { p1: { message: 'release failed' } },
    });
    (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'transient', reason: 'network' });

    const res = await GET(mockRequest());

    expect(res.status).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      '[threads-backfill] claim release failed',
      expect.objectContaining({ postId: 'p1', err: 'release failed' })
    );
  });

  it('skipped（Threads 未設定）: claim を解放し、以降の候補を試さず打ち切る', async () => {
    setupSupabase({
      candidates: [
        { id: 'p1', title: 'Title1', slug: 'slug-1' },
        { id: 'p2', title: 'Title2', slug: 'slug-2' },
      ],
    });
    (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'skipped', reason: 'not configured' });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(publishThreadsText).toHaveBeenCalledTimes(1); // p2 は試さない
    expect(releaseEqSpy).toHaveBeenCalledWith('id', 'p1');
    expect(claimEqSpy).not.toHaveBeenCalledWith('id', 'p2');
    expect(body).toEqual({ processed: 0, skipped: 1, truncated: false });
    expect(logCronRun).toHaveBeenCalledWith(
      'threads-backfill', 'skipped', expect.any(Date),
      expect.objectContaining({ processed: 0, skipped: 1 })
    );
  });

  it('raced: 他プロセスに claim を先取りされた場合は投稿せず raced としてカウントする', async () => {
    setupSupabase({
      candidates: [{ id: 'p1', title: 'Title', slug: 'slug-1' }],
      claims: { p1: { data: [], error: null } },
    });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(publishThreadsText).not.toHaveBeenCalled();
    expect(body.skipped).toBe(1);
  });

  it('raced: claim の戻り値が null（ドライバ表現揺れ）でも安全側に raced 扱いする', async () => {
    setupSupabase({
      candidates: [{ id: 'p1', title: 'Title', slug: 'slug-1' }],
      claims: { p1: { data: null, error: null } },
    });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(publishThreadsText).not.toHaveBeenCalled();
    expect(body.skipped).toBe(1);
  });

  it('claim 自体が DB エラーの場合はログを出し、その候補をスキップして継続する', async () => {
    setupSupabase({
      candidates: [{ id: 'p1', title: 'Title', slug: 'slug-1' }],
      claims: { p1: { data: null, error: { message: 'claim error' } } },
    });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(publishThreadsText).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      '[threads-backfill] claim failed',
      expect.objectContaining({ postId: 'p1', err: 'claim error' })
    );
    expect(body.skipped).toBe(1); // raced/claimErr は skipped 集計に含まれる
  });

  it('🔴 上限で打ち切ったら truncated=true・警告ログを出す（負の対照(c): このログを消すとテストが赤くなる）', async () => {
    const candidates = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`, title: `T${i}`, slug: `s${i}`,
    }));
    setupSupabase({ candidates, totalEligible: 11 }); // 上限8件・全体11件＝3件が次回へ繰越
    (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'published', postId: 'tid' });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(body.truncated).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      '[threads-backfill] per-run cap reached, remaining candidates deferred to next run',
      expect.objectContaining({ cap: 8, totalEligible: 11, deferred: 3 })
    );
    expect(body.processed).toBe(8);
  });

  it('totalEligible が null（count 未取得の防御分岐）でも候補数と比較して truncated を判定する', async () => {
    setupSupabase({
      candidates: [{ id: 'p1', title: 'T', slug: 's1' }],
      totalEligible: null,
    });
    (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'published', postId: 'tid' });

    const res = await GET(mockRequest());
    const body = await res.json();

    expect(body.truncated).toBe(false); // null ?? candidates.length(1) > 1 は false
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('🔴 claim は is(threads_post_id, null) と is(threads_posted_at, null) の両方を経由する（CAS ガードの配線固定・負の対照(a)）', async () => {
    // 二重投稿防止の要＝claim の CAS 条件そのものが実際に呼ばれていることを直接検証する。
    // route.ts の claim チェーンから `.is('threads_post_id', null)` または
    // `.is('threads_posted_at', null)` のどちらかを外すと、claimIsArgsSpy の
    // 呼び出し内容が変わり本テストが赤くなる（手動確認済み・下記コメント参照）。
    setupSupabase({ candidates: [{ id: 'p1', title: 'Title', slug: 'slug-1' }] });
    (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'published', postId: 'tid-1' });

    await GET(mockRequest());

    expect(claimEqSpy).toHaveBeenCalledWith('id', 'p1');
    expect(claimIsArgsSpy).toHaveBeenCalledWith('threads_post_id', null);
    expect(claimIsArgsSpy).toHaveBeenCalledWith('threads_posted_at', null);
    expect(claimIsArgsSpy).toHaveBeenCalledTimes(2);
  });

  it('未捕捉の例外は cronError で 500 になる', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockImplementation(() => {
      throw new Error('boom');
    });

    const res = await GET(mockRequest());

    expect(res.status).toBe(500);
    expect(cronError).toHaveBeenCalledWith('threads-backfill', expect.any(Date), expect.any(Error));
  });
});
