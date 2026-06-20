/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/daily-summary
 * 集計本体は RPC aggregate_daily_revenue（集合処理）に移行したため、ルートは
 *   - CRON_SECRET 認証
 *   - 前日(JST)の日付で RPC を1回呼ぶ
 *   - RPC 成功→processed / RPC エラー→500 / 例外→500
 * を検証する（集計ロジックそのものの正しさは DB 関数側＝SQL の責務）。
 */

jest.mock('@/lib/supabase-server');
jest.mock('@/lib/cron-auth');
jest.mock('@/lib/cron-logger');

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { GET } from '../route';

const mockRpc = jest.fn();

function makeRequest() {
  return new Request('http://localhost/api/cron/daily-summary');
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);
  (createServiceRoleClient as jest.Mock).mockReturnValue({ rpc: mockRpc });
});

test('CRON_SECRET 不正 → 401（RPC を呼ばない）', async () => {
  (checkCronAuth as jest.Mock).mockReturnValue(new Response('unauthorized', { status: 401 }));
  const res = await GET(makeRequest());
  expect(res.status).toBe(401);
  expect(mockRpc).not.toHaveBeenCalled();
});

test('集計成功 → processed に RPC 戻り値、前日(JST)の日付で呼ぶ', async () => {
  mockRpc.mockResolvedValue({ data: 5, error: null });
  const res = await GET(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.processed).toBe(5);
  expect(json.skipped).toBe(0);
  expect(mockRpc).toHaveBeenCalledWith(
    'aggregate_daily_revenue',
    expect.objectContaining({ p_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
  );
});

test('RPC 戻り値 null → processed 0', async () => {
  mockRpc.mockResolvedValue({ data: null, error: null });
  const res = await GET(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.processed).toBe(0);
});

test('RPC エラー → 500 + error ログ', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
  expect(logCronRun).toHaveBeenCalledWith(
    'daily-summary',
    'error',
    expect.anything(),
    expect.objectContaining({ error_msg: expect.any(String) }),
  );
});

test('予期しない例外(Error) → 500', async () => {
  mockRpc.mockRejectedValue(new Error('unexpected'));
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
});

test('予期しない例外(非Error) → 500（error_msg は String 化）', async () => {
  mockRpc.mockRejectedValue('string-error');
  const res = await GET(makeRequest());
  expect(res.status).toBe(500);
  expect(logCronRun).toHaveBeenCalledWith(
    'daily-summary',
    'error',
    expect.anything(),
    expect.objectContaining({ error_msg: 'string-error' }),
  );
});
