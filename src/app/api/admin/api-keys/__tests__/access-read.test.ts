/** @jest-environment node */
jest.mock('@/lib/supabase-server-auth');
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { DELETE } from '../[id]/route';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';

const id = '11111111-1111-1111-1111-111111111111';
const from = jest.fn();
const adminFrom = jest.fn();
const update = jest.fn();
const failure = { code: '08006', message: 'private input and key details', details: 'private SQL' };

function chain(data: unknown, error: unknown) {
  const result = jest.fn().mockResolvedValue({ data, error });
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(),
    single: result, maybeSingle: result };
}

beforeEach(() => {
  jest.clearAllMocks();
  (createServerSupabaseAuthClient as jest.Mock).mockResolvedValue({ auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id } }, error: null }) }, from });
  (createServiceRoleClient as jest.Mock).mockReturnValue({ from: adminFrom });
});

function request(operation: 'create' | 'list' | 'delete') {
  const url = `http://localhost/api/admin/api-keys?facility_id=${id}`;
  if (operation === 'list') return GET(new NextRequest(url));
  if (operation === 'delete') return DELETE(new NextRequest(url, { method: 'DELETE' }), { params: Promise.resolve({ id }) });
  return POST(new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facility_id: id, name: 'synthetic key', scopes: ['bookings:read'] }) }));
}

async function expectFailure(operation: 'create' | 'list' | 'delete', tag: string) {
  const res = await request(operation);
  expect(res.status).toBe(500);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(await res.json()).toEqual({ error: 'サーバーエラーが発生しました' });
  const diagnostic = expect.objectContaining({ message: 'DATABASE_FAILURE:08006' });
  const path = operation === 'delete' ? '/api/admin/api-keys/[id]' : '/api/admin/api-keys';
  expect(require('@/lib/safe').safeCaptureException).toHaveBeenCalledWith(diagnostic, tag);
  expect(require('@/lib/alert').alertCaughtError).toHaveBeenCalledWith(tag, diagnostic, path);
  expect(update).not.toHaveBeenCalled();
  expect(require('@/lib/audit-logger').writeAuditLog).not.toHaveBeenCalled();
}

describe.each(['create', 'list', 'delete'] as const)('%s membership lookup', operation => {
  test.each([null, { role: 'owner' }])('DB error with data=%j never grants access or certifies absence', async data => {
    from.mockReturnValue(chain(data, failure));
    adminFrom.mockReturnValue({ ...chain({ facility_id: id }, null), update });
    await expectFailure(operation, `admin-api-keys-${operation}-membership`);
    if (operation !== 'delete') expect(createServiceRoleClient).not.toHaveBeenCalled();
    else expect(adminFrom).toHaveBeenCalledTimes(1);
  });
});

test.each([null, { facility_id: id }])('key lookup DB error with data=%j never continues to membership or update', async data => {
  adminFrom.mockReturnValue({ ...chain(data, failure), update });
  await expectFailure('delete', 'admin-api-keys-delete-read');
  expect(from).not.toHaveBeenCalled();
  expect(adminFrom).toHaveBeenCalledTimes(1);
});
