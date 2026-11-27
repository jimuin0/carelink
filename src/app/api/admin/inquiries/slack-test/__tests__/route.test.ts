/** @jest-environment node */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('@/lib/safe', () => ({ ...jest.requireActual('@/lib/safe'), safeCaptureException: jest.fn(), safeCaptureMessage: jest.fn() }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@/lib/inquiry-slack-actions', () => ({ postInquiryResolveTestButton: jest.fn() }));
const mockGetUser = jest.fn();
const mockFrom = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockFrom, auth: { getUser: mockGetUser } }) }));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { postInquiryResolveTestButton } from '@/lib/inquiry-slack-actions';
import { writeAuditLog } from '@/lib/audit-logger';

const userId = '33333333-3333-4333-8333-333333333333';
const maybeSingle = jest.fn();
function request(origin = 'http://localhost') {
  return new NextRequest('http://localhost/api/admin/inquiries/slack-test', { method: 'POST', headers: { origin, host: 'localhost' } });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(checkRateLimit).mockResolvedValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mockFrom.mockReturnValue({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnValue({ maybeSingle }) });
  maybeSingle.mockResolvedValue({ data: { is_platform_admin: true }, error: null });
  jest.mocked(postInquiryResolveTestButton).mockResolvedValue(true);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  delete process.env.NEXT_PUBLIC_BASE_URL;
});

test('運営管理者ならテスト通知を送り、監査ログを残す', async () => {
  const res = await POST(request());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(postInquiryResolveTestButton).toHaveBeenCalledWith('https://carelink-jp.com/admin/inquiries');
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ userId, newValues: { slack_test_notification: true } }));
});

test('設定済みの URL を使う', async () => {
  process.env.NEXT_PUBLIC_BASE_URL = 'https://staging.example.invalid';
  await POST(request());
  expect(postInquiryResolveTestButton).toHaveBeenCalledWith('https://staging.example.invalid/admin/inquiries');
});

test('未ログインは 401・管理者でなければ 403・プロフィールが無ければ 403（送らない）', async () => {
  mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
  expect((await POST(request())).status).toBe(401);
  maybeSingle.mockResolvedValueOnce({ data: { is_platform_admin: false }, error: null });
  expect((await POST(request())).status).toBe(403);
  maybeSingle.mockResolvedValueOnce({ data: null, error: null });
  expect((await POST(request())).status).toBe(403);
  expect(postInquiryResolveTestButton).not.toHaveBeenCalled();
});

test('管理者確認の失敗は 500（送らない・内部の文言を返さない）', async () => {
  maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'private' } });
  const res = await POST(request());
  expect(res.status).toBe(500);
  expect(await res.text()).not.toContain('private');
  expect(postInquiryResolveTestButton).not.toHaveBeenCalled();
});

test('Slack に送れなければ 502（監査ログは残さない）', async () => {
  jest.mocked(postInquiryResolveTestButton).mockResolvedValueOnce(false);
  expect((await POST(request())).status).toBe(502);
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test('別のサイトからの POST は 403（CSRF）・回数制限中は 429', async () => {
  expect((await POST(request('https://evil.example'))).status).toBe(403);
  jest.mocked(checkRateLimit).mockResolvedValueOnce(true);
  expect((await POST(request())).status).toBe(429);
  expect(postInquiryResolveTestButton).not.toHaveBeenCalled();
});
