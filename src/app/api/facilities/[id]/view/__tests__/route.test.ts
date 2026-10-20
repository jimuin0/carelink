/**
 * @jest-environment node
 *
 * POST /api/facilities/[id]/view — 公開施設の閲覧だけを、IP・施設ごとに 30 分 1 回まで数える。
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn() }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));

import { NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { POST } from '../route';

const ID = '550e8400-e29b-41d4-a716-446655440000';
let facility: { data: unknown; error: unknown };
let rpcResult: { error: unknown };
const rpc = jest.fn(async () => rpcResult);
const eqs: Array<[string, unknown]> = [];

function request(id = ID) {
  return new Request(`https://carelink-jp.com/api/facilities/${id}/view`, { method: 'POST' });
}

beforeEach(() => {
  jest.clearAllMocks();
  eqs.length = 0;
  facility = { data: { id: ID }, error: null };
  rpcResult = { error: null };
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  const query: Record<string, unknown> = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn((column: string, value: unknown) => { eqs.push([column, value]); return query; });
  query.maybeSingle = jest.fn(async () => facility);
  (createServiceRoleClient as jest.Mock).mockReturnValue({ from: jest.fn(() => query), rpc });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

test('公開施設の初回閲覧を記録して 204 を返す', async () => {
  const res = await POST(request());
  expect(res.status).toBe(204);
  expect(eqs).toEqual([['id', ID], ['status', 'published']]);
  expect(rpc).toHaveBeenCalledWith('record_facility_page_view', { facility_uuid: ID });
  expect(checkRateLimit).toHaveBeenCalledWith(null, expect.any(String), 1, 30 * 60_000, `facility-view:${ID}`);
});

test('同じ IP・施設の 30 分以内の再閲覧は数えずに 204', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  expect((await POST(request())).status).toBe(204);
  expect(createServiceRoleClient).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

test('IP 全体の上限を超えたら 429 で記録しない', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValueOnce(true);
  expect((await POST(request())).status).toBe(429);
  expect(rpc).not.toHaveBeenCalled();
});

test('非公開・存在しない施設は数えない', async () => {
  facility = { data: null, error: null };
  expect((await POST(request())).status).toBe(204);
  expect(rpc).not.toHaveBeenCalled();
});

test('不正な ID は 400', async () => {
  expect((await POST(request('not-a-uuid'))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});

test('CSRF 不一致は記録しない', async () => {
  (checkCsrf as jest.Mock).mockReturnValueOnce(NextResponse.json({ error: 'forbidden' }, { status: 403 }));
  expect((await POST(request())).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});

test('施設の読取失敗・記録失敗は成功扱いにせず 500', async () => {
  facility = { data: null, error: { code: '08006' } };
  expect((await POST(request())).status).toBe(500);
  expect(rpc).not.toHaveBeenCalled();
  facility = { data: { id: ID }, error: null };
  rpcResult = { error: { code: '23503' } };
  expect((await POST(request())).status).toBe(500);
});
