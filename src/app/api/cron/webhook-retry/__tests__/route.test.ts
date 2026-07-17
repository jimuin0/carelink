/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/webhook-retry
 * Key assertions:
 *   - CRON_SECRET validation
 *   - Finds pending jobs scheduled_at <= now
 *   - Claims jobs (status=processing・claimed_at 記録) for idempotency
 *   - Stale reclaim は claimed_at 基準（null フォールバック付き）で処理中の孤児を回収する
 *   - Processes line_push & email webhook types
 *   - Updates status=success・delivered_at on completion
 *   - Schedules retry on failure（dead-letter / rescheduled を区別して alertDeliveryFailures へ集計）
 *   - queue_pending を meta に記録する（観測性）
 *   - Counts success/failed
 *   - Logs cron execution
 */

jest.mock('@/lib/cron-auth', () => ({
  checkCronAuth: jest.fn(() => null),
}));
jest.mock('@/lib/cron-logger');
jest.mock('@/lib/webhook-queue');
jest.mock('@/lib/line');
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/alert', () => ({
  alertDeliveryFailures: jest.fn(),
}));
jest.mock('resend');

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { scheduleRetry } from '@/lib/webhook-queue';
import { sendLineText } from '@/lib/line';
import { alertDeliveryFailures } from '@/lib/alert';
import { GET } from '../route';

let mockJobsSelect: jest.Mock;
let mockClaimUpdate: jest.Mock;
let mockSuccessUpdate: jest.Mock;
let mockReclaimUpdate: jest.Mock;
let mockQueuePendingEq: jest.Mock;
let mockTableUpdateDispatch: jest.Mock;
let mockSendLineText: jest.Mock;

/**
 * webhook_retry_queue テーブルの select/update チェーンを構築する共有ヘルパー。
 *
 * select は2つの呼び出しパターンを持つ:
 *   (1) ジョブ取得: select('*').eq('status','pending').lte('scheduled_at',now).order().limit()
 *   (2) queue_pending 観測: select('id', {count:'exact', head:true}).eq('status','pending')
 *       → { count } を返す（count/head 指定の有無で分岐する）
 *
 * update は書き込むデータの status で分岐する:
 *   'processing' = claim（claimed_at を記録）
 *   'success'    = 配信成功（delivered_at を記録）
 *   それ以外(='pending' + claimed_at:null) = stale reclaim
 *     （旧実装の .eq('status','processing').lt('scheduled_at',...) から
 *      .eq('status','processing').or('claimed_at.lt....,and(claimed_at.is.null,scheduled_at.lt....)')
 *      へ変更＝claim 時刻基準・null フォールバック付き）
 */
function makeWebhookRetryQueueTable(overrides: {
  jobsSelect: jest.Mock;
  claimUpdate: jest.Mock;
  successUpdate: jest.Mock;
  reclaimUpdate: jest.Mock;
  queuePendingEq: jest.Mock;
}) {
  const updateDispatch = jest.fn((data: any) => {
    if (data.status === 'processing') return overrides.claimUpdate(data);
    if (data.status === 'success') return overrides.successUpdate(data);
    return {
      eq: jest.fn().mockReturnValue({
        or: overrides.reclaimUpdate,
      }),
    };
  });
  return {
    select: jest.fn((_col: string, selectOpts?: { count?: string; head?: boolean }) => {
      if (selectOpts && selectOpts.count) {
        return { eq: overrides.queuePendingEq };
      }
      return {
        eq: jest.fn().mockReturnValue({
          lte: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: overrides.jobsSelect,
            }),
          }),
        }),
      };
    }),
    update: updateDispatch,
  };
}

function setupDefaultMocks(
  jobsFound: number = 1,
  claimFails: boolean = false,
  sendFails: boolean = false,
  reclaimFails: boolean = false
) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);
  (scheduleRetry as jest.Mock).mockResolvedValue('rescheduled');
  (alertDeliveryFailures as jest.Mock).mockReset();
  // sendLineText は成功時 true / 失敗時 false を返す契約（route 側が戻り値で成否判定）。
  mockSendLineText = jest.fn().mockResolvedValue(true);
  (sendLineText as jest.Mock).mockImplementation(mockSendLineText);

  if (sendFails) {
    mockSendLineText.mockRejectedValue(new Error('Send failed'));
  }

  mockJobsSelect = jest.fn().mockResolvedValue({
    data:
      jobsFound > 0
        ? [
            {
              id: 'job-1',
              webhook_type: 'line_push',
              target_id: 'line-user-123',
              payload: { message: 'Test message' },
              status: 'pending',
              attempt_count: 0,
              scheduled_at: new Date(Date.now() - 1000).toISOString(),
            },
            {
              id: 'job-2',
              webhook_type: 'email',
              payload: {
                to: 'user@example.com',
                subject: 'Test',
                html: '<p>Test</p>',
              },
              status: 'pending',
              attempt_count: 1,
              scheduled_at: new Date(Date.now() - 2000).toISOString(),
            },
          ]
        : [],
  });

  // 真のCAS: update({status:'processing',claimed_at}).in('id',ids).eq('status','pending').select('id')
  // → 実際に claim できた行の id を返す。既定は全行 claim 成功。
  mockClaimUpdate = jest.fn().mockReturnValue({
    in: jest.fn((_col: string, ids: string[]) => ({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({
          data: claimFails ? null : ids.map((id) => ({ id })),
          error: claimFails ? new Error('Claim failed') : null,
        }),
      }),
    })),
  });

  mockSuccessUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({
      error: null,
    }),
  });

  // stale processing 再回収 update(...).eq('status','processing').or(filterString)
  mockReclaimUpdate = jest.fn().mockResolvedValue({
    error: reclaimFails ? new Error('reclaim failed') : null,
  });

  // queue_pending 観測 select('id',{count:'exact',head:true}).eq('status','pending')
  mockQueuePendingEq = jest.fn().mockResolvedValue({ count: 0, error: null });

  // route.ts は .from('webhook_retry_queue') を1 run 内で複数回呼ぶ（reclaim・jobs select・
  // claim・success・queue_pending）。呼び出しごとに毎回新しい table オブジェクトを作ると
  // update ディスパッチャの参照が最後の呼び出しで上書きされテストから検証できなくなるため、
  // table オブジェクトは1回だけ構築し、from() は常に同じ参照を返す。
  const webhookRetryQueueTable = makeWebhookRetryQueueTable({
    jobsSelect: mockJobsSelect,
    claimUpdate: mockClaimUpdate,
    successUpdate: mockSuccessUpdate,
    reclaimUpdate: mockReclaimUpdate,
    queuePendingEq: mockQueuePendingEq,
  });
  mockTableUpdateDispatch = webhookRetryQueueTable.update as jest.Mock;

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'webhook_retry_queue') {
        return webhookRetryQueueTable;
      }
      return {};
    }),
  });

  const { Resend } = require('resend');
  Resend.mockImplementation(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({ success: true }),
    },
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.RESEND_API_KEY = 'resend-key';
  process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'line-token';
});

function makeRequest(cronSecret: string = 'cron-secret') {
  return new Request('http://localhost/api/cron/webhook-retry', {
    method: 'GET',
    headers: { authorization: `Bearer ${cronSecret}` },
  });
}

describe('GET /api/cron/webhook-retry', () => {
  test('invalid CRON_SECRET → returns auth error', async () => {
    (checkCronAuth as jest.Mock).mockReturnValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    );

    const res = await GET(makeRequest('invalid') as any);

    expect(res.status).toBe(401);
  });

  test('no pending jobs → 200 with processed=0', async () => {
    setupDefaultMocks(0);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
  });

  test('jobs 取得が DB エラー → error ログ＋500（無音スキップにしない）', async () => {
    setupDefaultMocks(0);
    mockJobsSelect.mockResolvedValue({ data: null, error: { message: 'db down' } });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    const { logCronRun } = require('@/lib/cron-logger');
    expect((logCronRun as jest.Mock).mock.calls.some((c: any[]) => c[1] === 'error')).toBe(true);
  });

  test('pending jobs found → processes', async () => {
    setupDefaultMocks(1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBeGreaterThanOrEqual(0);
  });

  test('claims jobs (status=processing)', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockClaimUpdate).toHaveBeenCalled();
  });

  test('claim update に claimed_at（claim時刻）を含む', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    const call = mockClaimUpdate.mock.calls[0][0];
    expect(call.status).toBe('processing');
    expect(typeof call.claimed_at).toBe('string');
    expect(Number.isNaN(new Date(call.claimed_at).getTime())).toBe(false);
  });

  test('開始時に stale processing 孤児を pending へ再回収する', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    // 再回収 update(...).eq('status','processing').or(filterString) が呼ばれる
    expect(mockReclaimUpdate).toHaveBeenCalled();
  });

  test('stale reclaim は claimed_at 基準の .or() フィルタ（null フォールバック付き）で status=pending・claimed_at=null に更新する', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    // update body: { status: 'pending', claimed_at: null }
    const reclaimCall = mockTableUpdateDispatch.mock.calls.find((c: any[]) => c[0].status === 'pending');
    expect(reclaimCall).toBeDefined();
    expect(reclaimCall![0].claimed_at).toBeNull();

    // .or() フィルタ文字列: claimed_at 基準＋claimed_at IS NULL 時は scheduled_at フォールバック
    const filterArg = mockReclaimUpdate.mock.calls[0][0] as string;
    expect(filterArg).toContain('claimed_at.lt.');
    expect(filterArg).toContain('and(claimed_at.is.null,scheduled_at.lt.');
  });

  test('stale processing 再回収が失敗しても本処理は継続する（best-effort）', async () => {
    setupDefaultMocks(1, false, false, true); // reclaimFails=true

    const res = await GET(makeRequest() as any);

    // 再回収失敗（console.error のみ）でも pending ジョブ処理は通常通り 200
    expect(res.status).toBe(200);
    expect(mockClaimUpdate).toHaveBeenCalled();
  });

  test('claim fails → returns 500', async () => {
    setupDefaultMocks(1, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('claim は真のCAS（.eq(status,pending)＋.select(id)）で行う', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    // update({status:'processing', claimed_at}) → .in('id', ids) → .eq('status','pending') → .select('id')
    const inMock = mockClaimUpdate.mock.results[0].value.in as jest.Mock;
    expect(inMock).toHaveBeenCalledWith('id', ['job-1', 'job-2']);
    const eqMock = inMock.mock.results[0].value.eq as jest.Mock;
    expect(eqMock).toHaveBeenCalledWith('status', 'pending');
    const selectMock = eqMock.mock.results[0].value.select as jest.Mock;
    expect(selectMock).toHaveBeenCalledWith('id');
  });

  test('claim 競合（並行runが一部行を先取り）→ claimできた行のみ処理し、取れなかった行は送信しない', async () => {
    setupDefaultMocks(1);
    // SELECT は job-1(line_push)・job-2(email) の2行を返すが、CAS の update 結果は job-1 のみ
    //（job-2 は並行 run が先に processing へ倒した＝status<>'pending' で UPDATE 対象外）。
    mockClaimUpdate.mockReturnValue({
      in: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({ data: [{ id: 'job-1' }], error: null }),
        }),
      }),
    });
    const sendSpy = jest.fn().mockResolvedValue({ success: true });
    const { Resend } = require('resend');
    Resend.mockImplementation(() => ({ emails: { send: sendSpy } }));

    const res = await GET(makeRequest() as any);
    const json = await res.json();

    // job-1（line_push）のみ処理される
    expect(mockSendLineText).toHaveBeenCalledTimes(1);
    // job-2（email）は claim できなかった＝Resend 送信されない（二重送信の発症前予防）
    expect(sendSpy).not.toHaveBeenCalled();
    // success マークも claim できた1行分のみ
    expect(mockSuccessUpdate).toHaveBeenCalledTimes(1);
    expect(json.processed).toBe(1);
    expect(json.skipped).toBe(0);
  });

  test('claim 全敗（全行を並行runが先取り）→ 1件も処理せず skipped で正常終了', async () => {
    setupDefaultMocks(1);
    mockClaimUpdate.mockReturnValue({
      in: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.processed).toBe(0);
    expect(json.skipped).toBe(0);
    expect(mockSendLineText).not.toHaveBeenCalled();
    expect(mockSuccessUpdate).not.toHaveBeenCalled();
    expect(logCronRun).toHaveBeenCalledWith(
      'webhook-retry', 'skipped', expect.any(Date),
      expect.objectContaining({ processed: 0, skipped: 0, meta: { total: 2, claimed: 0 } }),
    );
  });

  test('claim の update 結果 data=null（error無し）→ 0行claim扱いで安全側に倒す', async () => {
    setupDefaultMocks(1);
    mockClaimUpdate.mockReturnValue({
      in: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.processed).toBe(0);
    expect(mockSendLineText).not.toHaveBeenCalled();
  });

  test('line_push webhook → sends LINE text', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockSendLineText).toHaveBeenCalled();
  });

  test('email webhook → sends via Resend', async () => {
    setupDefaultMocks(1);

    const { Resend } = require('resend');

    await GET(makeRequest() as any);

    expect(Resend).toHaveBeenCalled();
  });

  test('success → updates status=success・delivered_at・attempt_count++', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockSuccessUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        delivered_at: expect.any(String),
      })
    );
  });

  test('failure → calls scheduleRetry', async () => {
    setupDefaultMocks(1, false, true);

    await GET(makeRequest() as any);

    expect(scheduleRetry).toHaveBeenCalled();
  });

  test('success マーク更新が失敗し続けても CRITICAL で可視化し再送はしない（二重配信の発症前予防）', async () => {
    // 配信成功後の status=success 更新が継続的に DB エラーになるケース。旧実装は error を握り潰し、
    // 行が processing のまま残り stale reclaim 経由で再送＝二重配信になっていた。
    setupDefaultMocks(1);
    mockSuccessUpdate.mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: new Error('db down') }) });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await GET(makeRequest() as any);
    const json = await res.json();

    // 配信は完了済みなので success として計上され、失敗キュー(skipped)には回さない。
    expect(json.processed).toBeGreaterThanOrEqual(1);
    expect(json.skipped).toBe(0);
    // 配信済みのため再送キューには戻さない（scheduleRetry を呼ばない＝二重配信を作らない）。
    expect(scheduleRetry).not.toHaveBeenCalled();
    // 再送リスク（reclaim 経由の二重配信）を CRITICAL ログで可視化する（サイレントにしない）。
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('CRITICAL'))).toBe(true);
    errSpy.mockRestore();
  });

  test('line_push returns false (retries exhausted) → scheduleRetry, not silent success', async () => {
    // sendLineText が throw せず false を返す配信失敗ケース。
    // 戻り値を無視していた旧実装では status='success' に倒れ通知が消失していた。
    // false を throw → scheduleRetry に回ることを検証（サイレントデータロス防止の回帰固定）。
    setupDefaultMocks(1);
    mockSendLineText.mockResolvedValue(false);

    await GET(makeRequest() as any);

    expect(scheduleRetry).toHaveBeenCalled();
    const call = (scheduleRetry as jest.Mock).mock.calls[0];
    expect(call[2]).toContain('line_push failed');
  });

  test('failure includes error message and attempt_count++', async () => {
    setupDefaultMocks(1, false, true);

    await GET(makeRequest() as any);

    const call = (scheduleRetry as jest.Mock).mock.calls[0];
    expect(call[1]).toBeGreaterThan(0); // attempt_count
    expect(call[2]).toEqual(expect.any(String)); // error message
  });

  test('scheduleRetry が "dead-letter" を返す → deadLettered を集計し alertDeliveryFailures の第4引数に渡す', async () => {
    // job-1(line_push) は send 失敗、job-2(email) は成功する構成にする。
    setupDefaultMocks(1, false, true); // sendFails=true → sendLineText が reject
    (scheduleRetry as jest.Mock).mockResolvedValueOnce('dead-letter');

    const res = await GET(makeRequest() as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    // job-1 は dead-letter・job-2 は成功
    expect(json.processed).toBe(1);
    expect(json.skipped).toBe(1);
    expect(alertDeliveryFailures).toHaveBeenCalledWith(
      'webhook-retry', 1, expect.objectContaining({ success: 1 }), 1,
    );
  });

  test('scheduleRetry が "rescheduled" を返す（既定）→ deadLettered=0 で alertDeliveryFailures を呼ぶ（他cron呼び出し元と同じ3引数相当の挙動）', async () => {
    setupDefaultMocks(1, false, true); // sendFails=true・scheduleRetry既定値は'rescheduled'

    const res = await GET(makeRequest() as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.skipped).toBe(1);
    expect(alertDeliveryFailures).toHaveBeenCalledWith(
      'webhook-retry', 1, expect.objectContaining({ success: 1 }), 0,
    );
  });

  test('logs cron execution with success count', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(logCronRun).toHaveBeenCalledWith(
      'webhook-retry',
      'success',
      expect.any(Date),
      expect.objectContaining({
        processed: expect.any(Number),
      })
    );
  });

  test('limits jobs to 50', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockJobsSelect).toHaveBeenCalled();
  });

  test('orders by scheduled_at ascending', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockJobsSelect).toHaveBeenCalled();
  });

  test('exception during processing → 500', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockImplementation(() => { throw new Error('Fatal'); }),
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('returns processed and failed counts', async () => {
    setupDefaultMocks(2, false, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('processed');
    expect(json).toHaveProperty('skipped');
  });

  test('individual job error → continues to next', async () => {
    setupDefaultMocks(2, false, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('skips Resend email if API key unavailable', async () => {
    delete process.env.RESEND_API_KEY;
    setupDefaultMocks(1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('skips LINE if no token', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
    setupDefaultMocks(1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('retry queue specific fields included', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    // Should process jobs with id, webhook_type, target_id/payload, attempt_count
  });

  test('updates processed_at on success', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    const call = mockSuccessUpdate.mock.calls[0];
    expect(call[0].processed_at).toBeDefined();
  });

  test('unknown webhook_type → scheduleRetry (not silent success)', async () => {
    // ハンドラ未実装の webhook_type（例: line_multicast）を「送信していないのに配信済み」＝
    // status='success' に倒すのはサイレントデータロス。scheduleRetry で保持し success には倒さない。
    mockJobsSelect = jest.fn().mockResolvedValue({
      data: [{
        id: 'jx',
        webhook_type: 'unknown_type',
        payload: {},
        status: 'pending',
        attempt_count: 0,
        scheduled_at: new Date().toISOString(),
      }],
    });
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'webhook_retry_queue') {
          return makeWebhookRetryQueueTable({
            jobsSelect: mockJobsSelect,
            claimUpdate: mockClaimUpdate,
            successUpdate: mockSuccessUpdate,
            reclaimUpdate: mockReclaimUpdate,
            queuePendingEq: mockQueuePendingEq,
          });
        }
        return {};
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    // 未配信なので success には倒さず、再送キューへ回す。
    expect(mockSuccessUpdate).not.toHaveBeenCalled();
    expect(scheduleRetry).toHaveBeenCalledWith('jx', 1, expect.stringContaining('unsupported webhook_type'));
    const json = await res.json();
    expect(json.processed).toBe(0);
    expect(json.skipped).toBe(1);
  });

  test('email webhook with resend null → scheduleRetry (not silent success)', async () => {
    // RESEND_API_KEY 未設定でメールを送れない場合、旧実装は送らずに success へ倒しメールを消失させていた。
    // キー復旧で送れる一過性事象なので scheduleRetry で保持し success には倒さない。
    delete process.env.RESEND_API_KEY;
    mockJobsSelect = jest.fn().mockResolvedValue({
      data: [{
        id: 'je',
        webhook_type: 'email',
        payload: { to: 't@x.com', subject: 's', html: '<p>x</p>' },
        status: 'pending',
        attempt_count: 0,
        scheduled_at: new Date().toISOString(),
      }],
    });
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'webhook_retry_queue') {
          return makeWebhookRetryQueueTable({
            jobsSelect: mockJobsSelect,
            claimUpdate: mockClaimUpdate,
            successUpdate: mockSuccessUpdate,
            reclaimUpdate: mockReclaimUpdate,
            queuePendingEq: mockQueuePendingEq,
          });
        }
        return {};
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(mockSuccessUpdate).not.toHaveBeenCalled();
    expect(scheduleRetry).toHaveBeenCalledWith('je', 1, expect.stringContaining('RESEND_API_KEY not configured'));
    const json = await res.json();
    expect(json.processed).toBe(0);
    expect(json.skipped).toBe(1);
  });

  test('email payload with explicit from → uses payload.from', async () => {
    mockJobsSelect = jest.fn().mockResolvedValue({
      data: [{
        id: 'jf',
        webhook_type: 'email',
        payload: { to: 't@x.com', subject: 's', html: '<p>x</p>', from: 'Custom <c@x.com>' },
        status: 'pending',
        attempt_count: 0,
        scheduled_at: new Date().toISOString(),
      }],
    });
    const sendSpy = jest.fn().mockResolvedValue({ success: true });
    const { Resend } = require('resend');
    Resend.mockImplementation(() => ({ emails: { send: sendSpy } }));
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'webhook_retry_queue') {
          return makeWebhookRetryQueueTable({
            jobsSelect: mockJobsSelect,
            claimUpdate: mockClaimUpdate,
            successUpdate: mockSuccessUpdate,
            reclaimUpdate: mockReclaimUpdate,
            queuePendingEq: mockQueuePendingEq,
          });
        }
        return {};
      }),
    });

    await GET(makeRequest() as any);
    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ from: 'Custom <c@x.com>' }));
  });

  test('non-Error throw inside per-job → scheduleRetry with String fallback', async () => {
    (sendLineText as jest.Mock).mockImplementationOnce(() => { throw 'string-err'; });
    setupDefaultMocks(1, false, false);

    await GET(makeRequest() as any);
    const call = (scheduleRetry as jest.Mock).mock.calls[0];
    expect(call[2]).toBe('string-err');
  });

  test('non-Error throw in outer catch → String fallback', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn(() => { throw 'outer-string'; }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(logCronRun).toHaveBeenCalledWith(
      'webhook-retry', 'error', expect.any(Date),
      expect.objectContaining({ error_msg: 'outer-string' }),
    );
  });

  test('uses scheduled_at for job timing (not created_at)', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    // Should filter by scheduled_at <= now
  });

  test('email webhook: p.from も EMAIL_FROM も未設定 → デフォルト差出人を使う（行90フォールバック）', async () => {
    // p.from も process.env.EMAIL_FROM も falsy のケース → デフォルト 'CareLink <noreply@carelink-jp.com>'
    delete process.env.EMAIL_FROM;
    const sendSpy = jest.fn().mockResolvedValue({ success: true });
    const { Resend } = require('resend');
    Resend.mockImplementation(() => ({ emails: { send: sendSpy } }));
    mockJobsSelect = jest.fn().mockResolvedValue({
      data: [{
        id: 'jf2',
        webhook_type: 'email',
        // from は意図的に省略（p.from = undefined）
        payload: { to: 't@x.com', subject: 's', html: '<p>x</p>' },
        status: 'pending',
        attempt_count: 0,
        scheduled_at: new Date().toISOString(),
      }],
    });
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'webhook_retry_queue') {
          return makeWebhookRetryQueueTable({
            jobsSelect: mockJobsSelect,
            claimUpdate: mockClaimUpdate,
            successUpdate: mockSuccessUpdate,
            reclaimUpdate: mockReclaimUpdate,
            queuePendingEq: mockQueuePendingEq,
          });
        }
        return {};
      }),
    });

    await GET(makeRequest() as any);
    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
      from: 'CareLink <noreply@carelink-jp.com>',
    }));
  });

  describe('queue_pending 観測（backlog の可視化）', () => {
    test('queue_pending の取得成功 → meta.queue_pending にカウントが入る', async () => {
      setupDefaultMocks(1);
      mockQueuePendingEq.mockResolvedValue({ count: 7, error: null });

      await GET(makeRequest() as any);

      expect(logCronRun).toHaveBeenCalledWith(
        'webhook-retry', 'success', expect.any(Date),
        expect.objectContaining({ meta: expect.objectContaining({ queue_pending: 7 }) }),
      );
    });

    test('queue_pending が count=null で解決（DBエラー等）→ meta.queue_pending は null', async () => {
      setupDefaultMocks(1);
      mockQueuePendingEq.mockResolvedValue({ count: null, error: { message: 'count failed' } });

      const res = await GET(makeRequest() as any);

      // 観測失敗は本体の成否に影響しない（200のまま）
      expect(res.status).toBe(200);
      expect(logCronRun).toHaveBeenCalledWith(
        'webhook-retry', 'success', expect.any(Date),
        expect.objectContaining({ meta: expect.objectContaining({ queue_pending: null }) }),
      );
    });

    test('queue_pending の取得が例外を throw → catch され console.error で可視化・本体は200のまま継続', async () => {
      setupDefaultMocks(1);
      mockQueuePendingEq.mockRejectedValue(new Error('network down'));
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const res = await GET(makeRequest() as any);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.processed).toBeGreaterThanOrEqual(1);
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('queue_pending observation failed'))).toBe(true);
      expect(logCronRun).toHaveBeenCalledWith(
        'webhook-retry', 'success', expect.any(Date),
        expect.objectContaining({ meta: expect.objectContaining({ queue_pending: null }) }),
      );
      errSpy.mockRestore();
    });
  });
});
