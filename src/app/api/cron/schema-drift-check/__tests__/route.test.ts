/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/schema-drift-check — branches 100%。
 *   - cron auth NG / RPC error→500 / ドリフト有→Slack警告 / ドリフト無→無通知
 */

jest.mock('@/lib/cron-auth', () => ({ checkCronAuth: jest.fn(() => null) }));
jest.mock('@/lib/cron-logger', () => ({ logCronRun: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertWarning: jest.fn() }));
jest.mock('@/lib/schema-drift', () => ({ computeDrift: jest.fn() }));

const mockRpc = jest.fn();
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ rpc: mockRpc }),
}));

import { GET } from '../route';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { alertWarning } from '@/lib/alert';
import { computeDrift } from '@/lib/schema-drift';

function req() {
  return new Request('http://localhost/api/cron/schema-drift-check', {
    headers: { authorization: 'Bearer x' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

test('cron auth NG → そのレスポンス', async () => {
  (checkCronAuth as jest.Mock).mockReturnValue(
    new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
  );
  expect((await GET(req())).status).toBe(401);
});

test('RPC エラー → 500 + logCronRun(error)', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'rpc fail' } });
  const res = await GET(req());
  expect(res.status).toBe(500);
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('error');
});

test('ドリフト有 → alertWarning 発火 + ok', async () => {
  mockRpc.mockResolvedValue({ data: [{ table_name: 'evil', column_name: 'x' }], error: null });
  (computeDrift as jest.Mock).mockReturnValue({
    contaminated: ['evil'],
    missing: [],
    colDrift: [],
  });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(1);
  expect(json.contaminated).toEqual(['evil']);
  expect(alertWarning as jest.Mock).toHaveBeenCalledTimes(1);
  expect((logCronRun as jest.Mock).mock.calls[0][1]).toBe('success');
});

test('ドリフト無(data=null) → 無通知 + ok', async () => {
  mockRpc.mockResolvedValue({ data: null, error: null });
  (computeDrift as jest.Mock).mockReturnValue({
    contaminated: [],
    missing: [],
    colDrift: [],
  });
  const res = await GET(req());
  const json = await res.json();
  expect(json.driftCount).toBe(0);
  expect(alertWarning as jest.Mock).not.toHaveBeenCalled();
});
