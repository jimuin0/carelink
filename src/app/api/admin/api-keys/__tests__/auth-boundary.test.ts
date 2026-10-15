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
import { AUTH_UNAVAILABLE_BODY } from '@/lib/auth-verification';

const id = '11111111-1111-1111-1111-111111111111';
const getUser = jest.fn();
const from = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (createServerSupabaseAuthClient as jest.Mock).mockResolvedValue({ auth: { getUser }, from });
});

describe.each(['create', 'list', 'delete'] as const)('API key %s authentication', operation => {
  function request() {
    const url = `http://localhost/api/admin/api-keys?facility_id=${id}`;
    if (operation === 'list') return GET(new NextRequest(url));
    if (operation === 'delete') return DELETE(new NextRequest(url, { method: 'DELETE' }), { params: Promise.resolve({ id }) });
    return POST(new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facility_id: id, name: 'synthetic key', scopes: ['bookings:read'] }) }));
  }

  function expectNoOperation() {
    expect(from).not.toHaveBeenCalled();
    expect(createServiceRoleClient).not.toHaveBeenCalled();
    expect(require('@/lib/audit-logger').writeAuditLog).not.toHaveBeenCalled();
  }

  async function expectUnavailable() {
    const response = await request();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual(AUTH_UNAVAILABLE_BODY);
    expectNoOperation();
    const tag = `admin-api-keys-${operation}-auth`;
    const path = operation === 'delete' ? '/api/admin/api-keys/[id]' : '/api/admin/api-keys';
    expect(require('@/lib/safe').safeCaptureException).toHaveBeenCalledWith(expect.objectContaining({ message: 'AUTH_UNAVAILABLE' }), tag);
    expect(require('@/lib/alert').alertCaughtError).toHaveBeenCalledWith(tag, expect.objectContaining({ message: 'AUTH_UNAVAILABLE' }), path, 503);
  }

  test.each([
    { data: { user: null }, error: { status: 503, message: 'private auth details' } },
    { data: { user: { id } }, error: { status: 503, message: 'private auth details' } },
    null,
  ])('uncertain identity stops before key access: %j', async result => {
    getUser.mockResolvedValueOnce(result);
    await expectUnavailable();
  });

  test('SDK rejection stops before key access', async () => {
    getUser.mockRejectedValueOnce(new Error('private auth details'));
    await expectUnavailable();
  });

  test('SDK timeout stops before key access', async () => {
    jest.useFakeTimers();
    try {
      getUser.mockImplementationOnce(() => new Promise(() => {}));
      const response = expectUnavailable();
      await jest.advanceTimersByTimeAsync(5000);
      await response;
    } finally { jest.useRealTimers(); }
  });

  test('genuine unauthenticated identity remains401 without key access', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await request()).status).toBe(401);
    expectNoOperation();
    expect(require('@/lib/alert').alertCaughtError).not.toHaveBeenCalled();
  });
});
