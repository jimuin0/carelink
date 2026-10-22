/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server';

// HPB 一括反映の下書き（30〜100 件）を 1 件ずつ公開すると、メニュー編集と共有のレート制限で途中で止まった。
// 選択中の施設の下書きを 1 回のトランザクションで公開することを固定する。
const facility = '22222222-2222-4222-8222-222222222222';
const other = '11111111-1111-4111-8111-111111111111';
const mockContext = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/admin-api-context', () => ({ getAdminApiContext: (...args: unknown[]) => mockContext(...args) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ rpc: mockRpc }) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';

const req = () => new NextRequest(`https://example.invalid/api/admin/menus/publish?facility_id=${facility}`, { method: 'POST' });

beforeEach(() => {
  jest.clearAllMocks();
  mockContext.mockResolvedValue({ userId: 'actor', facilityId: facility });
  mockRpc.mockResolvedValue({ data: { outcome: 'published', facility_id: facility, published: 42 }, error: null });
});

test('選択中の施設の下書きを 1 回の RPC で公開し、件数を返して監査ログを 1 件残す', async () => {
  const res = await POST(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ published: 42 });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('publish_admin_menus_atomic', { p_actor_id: 'actor', p_facility_id: facility });
  expect(writeAuditLog).toHaveBeenCalledTimes(1);
  expect((writeAuditLog as jest.Mock).mock.calls[0][0]).toMatchObject({ action: 'publish', tableName: 'facility_menus', facilityId: facility, newValues: { published: 42 } });
});

test('公開する下書きが無ければ 0 件を返し、監査ログは残さない', async () => {
  mockRpc.mockResolvedValue({ data: { outcome: 'published', facility_id: facility, published: 0 }, error: null });
  const res = await POST(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ published: 0 });
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test('CSRF で拒否されたら公開しない', async () => {
  (checkCsrf as jest.Mock).mockReturnValueOnce(NextResponse.json({}, { status: 403 }));
  expect((await POST(req())).status).toBe(403);
  expect(mockRpc).not.toHaveBeenCalled();
});

test('レート制限で拒否されたら公開しない', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValueOnce(true);
  expect((await POST(req())).status).toBe(429);
  expect(mockRpc).not.toHaveBeenCalled();
});

test('本人確認・所属確認に通らなければ公開しない', async () => {
  mockContext.mockResolvedValue(NextResponse.json({}, { status: 403 }));
  expect((await POST(req())).status).toBe(403);
  expect(mockRpc).not.toHaveBeenCalled();
});

test.each([['42501', 403], ['P0002', 404], ['08006', 500]])('DB %s は %i（理由の詳細は返さず、成功の監査ログも残さない）', async (code, status) => {
  mockRpc.mockResolvedValue({ data: null, error: { code, message: 'PRIVATE_DETAIL' } });
  const res = await POST(req());
  expect(res.status).toBe(status);
  expect(JSON.stringify(await res.json())).not.toContain('PRIVATE_DETAIL');
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test.each([
  null,
  { outcome: 'published', facility_id: other, published: 1 },
  { outcome: 'saved', facility_id: facility, published: 1 },
  { outcome: 'published', facility_id: facility, published: -1 },
])('施設や形の合わない応答は成功にしない %#', async (data) => {
  mockRpc.mockResolvedValue({ data, error: null });
  expect((await POST(req())).status).toBe(500);
  expect(writeAuditLog).not.toHaveBeenCalled();
});
