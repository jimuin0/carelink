/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/schema-drift-check — branches 100%。
 *   - cron auth NG / 列RPC error→500 / 列ドリフト有→Slack警告 / ドリフト無→無通知
 *   - 制約RPC error→skip(graceful) / 制約ドリフト有→警告
 */

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn(() => null) }));
jest.mock('@/lib/cron-logger', () => ({ logCronRun: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertWarning: jest.fn() }));
jest.mock('@/lib/schema-drift', () => ({
  computeDrift: jest.fn(),
  computeConstraintDrift: jest.fn(),
}));

const mockRpc = jest.fn();
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ rpc: mockRpc }),
}));

import { GET } from '../route';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { alertWarning } from '@/lib/alert';
import { computeDrift, computeConstraintDrift } from '@/lib/schema-drift';

function req() {
  return new Request('http://localhost/api/cron/schema-drift-check', {
    headers: { authorization: 'Bearer x' },
  });
}

const EMPTY_COL_DRIFT = { contaminated: [], missing: [], colDrift: [] };
const EMPTY_CONSTRAINT_DRIFT = { extra: [], missing: [] };

/** 列RPC(get_public_columns) と 制約RPC(get_public_constraints) を名前で出し分ける。 */
function setRpc(cols: unknown, constraints: unknown) {
  mockRpc.mockImplementation((name: string) =>
    Promise.resolve(name === 'get_public_columns' ? cols : constraints),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (computeDrift as jest.Mock).mockReturnValue(EMPTY_COL_DRIFT);
  (computeConstraintDrift as jest.Mock).mockReturnValue(EMPTY_CONSTRAINT_DRIFT);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

test('cron auth NG → そのレスポンス', async () => {
  (checkCronAuth as jest.Mock).mockReturnValue(
    new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
  );
  expect((await GET(req())).status).toBe(401);
});

test('列RPC エラー → 500 + logCronRun(error)（制約RPCに到達しない）', async () => {
  setRpc({ data: null, error: { message: 'rpc fail' } }, { data: [], error: null });
  const res = await GET(req());
  expect(res.status).toBe(500);
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('error');
});

test('列ドリフト有(data=配列) + 制約RPC成功・制約ドリフト無 → alert 発火', async () => {
  setRpc(
    { data: [{ table_name: 'evil', column_name: 'x' }], error: null },
    { data: [{ table_name: 't', kind: 'p', columns: 'id' }], error: null },
  );
  (computeDrift as jest.Mock).mockReturnValue({ contaminated: ['evil'], missing: [], colDrift: [] });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(1);
  expect(json.contaminated).toEqual(['evil']);
  expect(json.constraintCheckSkipped).toBe(false);
  expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('success');
});

test('ドリフト無(列data=null / 制約data=null) → 無通知 + ok', async () => {
  setRpc({ data: null, error: null }, { data: null, error: null });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(0);
  expect(json.constraintCheckSkipped).toBe(false);
  expect(alertWarning as jest.Mock).not.toHaveBeenCalled();
});

test('制約RPC エラー → graceful skip（constraintCheckSkipped=true・cron は壊れない）+ 監視無効化を警報', async () => {
  // C-8 根治: 制約RPC失敗は監視そのものが無効化される障害のため、従来の「無音skip」
  // ではなく alertWarning で恒久検知する（列レベルの drift 監視は継続・cron は 'success'）。
  setRpc({ data: [], error: null }, { data: null, error: { message: 'function does not exist' } });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(0);
  expect(json.constraintCheckSkipped).toBe(true);
  expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
  expect((alertWarning as jest.Mock).mock.calls[0][0]).toMatch(/制約ドリフト監視が無効化/);
});

test('制約ドリフト有(extra/missing) → driftCount に算入 + alert', async () => {
  setRpc(
    { data: [], error: null },
    { data: [{ table_name: 'review_helpful', kind: 'p', columns: 'review_id,user_id' }], error: null },
  );
  (computeConstraintDrift as jest.Mock).mockReturnValue({
    extra: ['review_helpful:p(review_id,user_id)'],
    missing: ['review_helpful:p(id)'],
  });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(2);
  expect(json.constraintExtra).toEqual(['review_helpful:p(review_id,user_id)']);
  expect(json.constraintMissing).toEqual(['review_helpful:p(id)']);
  expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
});
