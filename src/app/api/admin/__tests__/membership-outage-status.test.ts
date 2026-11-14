/**
 * @jest-environment node
 *
 * 点検「中」A11・A12：認証基盤・DB の障害を「401 Unauthorized／404」に化けさせない。
 * 以前は error を見ずに data だけで判定していたため、障害が「ログアウト・権限なし」に見え、通知も出なかった。
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => Promise.resolve(false)) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn(), getRequestContext: jest.fn(() => ({})) }));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const mockGetUser = jest.fn();
let mockResult: { data: unknown; error: unknown } = { data: null, error: null };
let mockQueue: { data: unknown; error: unknown }[] = [];

function chain(): unknown {
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve(mockQueue.length ? mockQueue.shift() : mockResult);
      if (prop === 'then') return undefined;
      return () => proxy;
    },
  });
  return proxy;
}

jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: jest.fn(() => Promise.resolve({ auth: { getUser: mockGetUser }, from: () => chain() })),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(() => ({ from: () => chain(), rpc: jest.fn() })),
}));

import { NextRequest } from 'next/server';
import * as packagesId from '../packages/[id]/route';
import * as plans from '../subscription-plans/route';
import * as plansId from '../subscription-plans/[id]/route';
import * as userPackages from '../user-packages/route';
import * as userSubs from '../user-subscriptions/route';

const ID = '11111111-1111-4111-8111-111111111111';
const DB_DOWN = { data: null, error: { code: '08006', message: 'connection failure' } };

function req(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: ID }) };

type Case = [string, () => Promise<Response>];
const cases: Case[] = [
  ['packages/[id] PATCH', () => packagesId.PATCH(req(`/api/admin/packages/${ID}`, 'PATCH', { name: 'x' }), params)],
  ['packages/[id] DELETE', () => packagesId.DELETE(req(`/api/admin/packages/${ID}`, 'DELETE'), params)],
  ['subscription-plans POST', () => plans.POST(req(`/api/admin/subscription-plans?facility_id=${ID}`, 'POST', { name: 'x', price: 1, sessions_per_month: 1, valid_months: 1 }))],
  ['subscription-plans/[id] DELETE', () => plansId.DELETE(req(`/api/admin/subscription-plans/${ID}`, 'DELETE'), params)],
  ['subscription-plans GET', () => plans.GET(req(`/api/admin/subscription-plans?facility_id=${ID}`, 'GET'))],
  ['subscription-plans/[id] PATCH', () => plansId.PATCH(req(`/api/admin/subscription-plans/${ID}`, 'PATCH', { name: 'x' }), params)],
  ['user-packages POST', () => userPackages.POST(req('/api/admin/user-packages', 'POST', { facility_id: ID, user_id: ID, package_id: ID, operation_id: ID }))],
  ['user-subscriptions PATCH(status)', () => userSubs.PATCH(req('/api/admin/user-subscriptions', 'PATCH', { subscription_id: ID, status: 'cancelled' }))],
  ['user-packages GET', () => userPackages.GET(req(`/api/admin/user-packages?facility_id=${ID}`, 'GET'))],
  ['user-packages PATCH', () => userPackages.PATCH(req('/api/admin/user-packages', 'PATCH', { user_package_id: ID, operation_id: ID }))],
  ['user-subscriptions GET', () => userSubs.GET(req(`/api/admin/user-subscriptions?facility_id=${ID}`, 'GET'))],
  ['user-subscriptions POST', () => userSubs.POST(req('/api/admin/user-subscriptions', 'POST', { facility_id: ID, user_id: ID, plan_id: ID, operation_id: ID }))],
  ['user-subscriptions PATCH(use)', () => userSubs.PATCH(req('/api/admin/user-subscriptions', 'PATCH', { subscription_id: ID }))],
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: ID } }, error: null });
  mockResult = { data: null, error: null };
  mockQueue = [];
});

test.each(cases)('%s: 認証基盤の障害 → 503（401 にしない）', async (_name, call) => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('network') });
  expect((await call()).status).toBe(503);
});

test.each(cases)('%s: DB 障害 → 500（401/404 にしない）', async (_name, call) => {
  mockResult = DB_DOWN;
  expect((await call()).status).toBe(500);
});

test.each(cases)('%s: 行が無い（PGRST116）→ 401/404 のまま', async (_name, call) => {
  mockResult = { data: null, error: { code: 'PGRST116' } };
  expect([401, 404]).toContain((await call()).status);
});

test('user-packages PATCH: 回数券は読めたが所属確認が DB 障害 → 500', async () => {
  mockQueue = [{ data: { user_id: 'someone-else', service_packages: { facility_id: ID } }, error: null }, DB_DOWN];
  expect((await userPackages.PATCH(req('/api/admin/user-packages', 'PATCH', { user_package_id: ID }))).status).toBe(500);
});

test('user-subscriptions PATCH(status): 契約は読めたが所属確認が DB 障害 → 500', async () => {
  mockQueue = [{ data: { facility_id: ID, status: 'active' }, error: null }, DB_DOWN];
  expect((await userSubs.PATCH(req('/api/admin/user-subscriptions', 'PATCH', { subscription_id: ID, status: 'cancelled' }))).status).toBe(500);
});

test('user-subscriptions: 所属確認以外の例外はそのまま投げる', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: ID } }, error: null });
  const { createServerSupabaseAuthClient } = jest.requireMock('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockImplementationOnce(() => Promise.resolve({ auth: { getUser: mockGetUser }, from: () => { throw new Error('boom'); } }));
  await expect(userSubs.GET(req(`/api/admin/user-subscriptions?facility_id=${ID}`, 'GET'))).rejects.toThrow('boom');
});

test.each([
  ['packages/[id]', () => packagesId.PATCH(req(`/api/admin/packages/${ID}`, 'PATCH', { name: 'x' }), params)],
  ['subscription-plans/[id]', () => plansId.PATCH(req(`/api/admin/subscription-plans/${ID}`, 'PATCH', { name: 'x' }), params)],
] as Case[])('%s: 対象は読めたが所属確認が DB 障害 → 500、所属なし（PGRST116）→ 401', async (_name, call) => {
  mockQueue = [{ data: { facility_id: ID }, error: null }, DB_DOWN];
  expect((await call()).status).toBe(500);
  mockQueue = [{ data: { facility_id: ID }, error: null }, { data: null, error: { code: 'PGRST116' } }];
  expect((await call()).status).toBe(401);
});
