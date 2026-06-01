/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/photos/upload（service-role 画像アップロード）
 */
jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockUpload = jest.fn();
const mockGetPublicUrl = jest.fn(() => ({ data: { publicUrl: 'https://cdn.example/x.png' } }));
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ storage: { from: () => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl }) } }),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function memberSingle(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data, error: null })) };
}
function makeReq(form: FormData | null, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/photos/upload');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'POST', body: form ?? undefined });
}
function fileForm(type: string, sizeBytes = 10) {
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array(sizeBytes)], 'a', { type }));
  return fd;
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockUpload.mockResolvedValue({ error: null });
});

test('CSRF → 403', async () => { (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}', { status: 403 })); expect((await POST(makeReq(fileForm('image/png')))).status).toBe(403); });
test('レートリミット → 429', async () => { (inMemoryRateLimit as jest.Mock).mockReturnValue(true); expect((await POST(makeReq(fileForm('image/png')))).status).toBe(429); });
test('未認証 → 401', async () => { mockGetUser.mockResolvedValue({ data: { user: null } }); expect((await POST(makeReq(fileForm('image/png')))).status).toBe(401); });
test('facility_id なし → 401', async () => { expect((await POST(makeReq(fileForm('image/png'), null))).status).toBe(401); });
test('非メンバー → 401', async () => { mockAnonFrom.mockReturnValue(memberSingle(null)); expect((await POST(makeReq(fileForm('image/png')))).status).toBe(401); });
test('ファイルなし → 400', async () => { mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); expect((await POST(makeReq(new FormData()))).status).toBe(400); });
test('未対応の形式 → 400', async () => { mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); expect((await POST(makeReq(fileForm('image/gif')))).status).toBe(400); });
test('5MB超 → 400', async () => { mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); expect((await POST(makeReq(fileForm('image/jpeg', 5 * 1024 * 1024 + 1)))).status).toBe(400); });
test('Storage アップロード失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockUpload.mockResolvedValue({ error: { message: 'up fail' } });
  expect((await POST(makeReq(fileForm('image/png')))).status).toBe(500);
});
test('PNG 正常 → 200 url', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const r = await POST(makeReq(fileForm('image/png')));
  expect(r.status).toBe(200);
  expect((await r.json()).url).toBe('https://cdn.example/x.png');
});
test('WebP 正常 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  expect((await POST(makeReq(fileForm('image/webp')))).status).toBe(200);
});
test('JPEG 正常 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  expect((await POST(makeReq(fileForm('image/jpeg')))).status).toBe(200);
});
