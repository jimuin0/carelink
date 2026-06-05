/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/newsletter
 * Key assertions:
 *   - Non-platform-admin → 403
 *   - Invalid campaign_type → 400
 *   - subject > 200 chars → 400
 *   - html_content > 100KB → 400
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeGetRequest() {
  return new NextRequest('http://localhost/api/admin/newsletter', { method: 'GET' });
}

function makePostRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/newsletter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validPostBody(overrides: object = {}) {
  return {
    campaign_type: 'user_digest',
    subject: 'テストメール',
    html_content: '<p>Hello</p>',
    ...overrides,
  };
}

// profiles → is_platform_admin check (anon client)
function profileSingle(isAdmin: boolean) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: { is_platform_admin: isAdmin }, error: null })),
  };
}

function campaignListChain(data: unknown[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn(() => Promise.resolve({ data, error })),
  };
}

function insertCampaignSingle(data: unknown, error: unknown = null) {
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data, error })),
      }),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── GET ──────────────────────────────────────────────────────────────────────

test('GET: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(403);
});

test('GET: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(429);
});

test('GET: 一般ユーザー → 403', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(false));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(403);
});

test('GET: 正常取得 → 200 with campaigns', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(campaignListChain([{ id: 'camp-1' }]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.campaigns).toBeDefined();
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(403);
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(429);
});

test('POST: 一般ユーザー → 403', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(false));
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(403);
});

test('POST: 不正な campaign_type → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await POST(makePostRequest(validPostBody({ campaign_type: 'spam' })));
  expect(res.status).toBe(400);
});

test('POST: subject が 201文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await POST(makePostRequest(validPostBody({ subject: 'a'.repeat(201) })));
  expect(res.status).toBe(400);
});

test('POST: html_content が 100001文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await POST(makePostRequest(validPostBody({ html_content: 'a'.repeat(100001) })));
  expect(res.status).toBe(400);
});

test('POST: 必須フィールド欠落 → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await POST(makePostRequest({ campaign_type: 'promo' })); // missing subject + html_content
  expect(res.status).toBe(400);
});

test('POST: DB挿入失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(insertCampaignSingle(null, { message: 'DB error' }));
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(500);
});

test('POST: 正常作成 → 201 with campaign', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(insertCampaignSingle({ id: 'camp-1', status: 'draft' }));
  const res = await POST(makePostRequest(validPostBody()));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.campaign).toBeDefined();
});

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(403);
});

test('POST: campaign_type=promo → 201', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(insertCampaignSingle({ id: 'camp-2', status: 'draft' }));
  const res = await POST(makePostRequest(validPostBody({ campaign_type: 'promo' })));
  expect(res.status).toBe(201);
});

test('POST: campaign_type=owner_monthly → 201', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(insertCampaignSingle({ id: 'camp-3', status: 'draft' }));
  const res = await POST(makePostRequest(validPostBody({ campaign_type: 'owner_monthly' })));
  expect(res.status).toBe(201);
});

test('POST: subject が 200文字 → 201', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(insertCampaignSingle({ id: 'camp-4' }));
  const res = await POST(makePostRequest(validPostBody({ subject: 'a'.repeat(200) })));
  expect(res.status).toBe(201);
});

test('POST: writeAuditLog が呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(insertCampaignSingle({ id: 'camp-5', status: 'draft' }));
  const { writeAuditLog } = require('@/lib/audit-logger');
  await POST(makePostRequest(validPostBody()));
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalled();
});

test('POST: レスポンスが { campaign: ... } 形式', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(insertCampaignSingle({ id: 'camp-1', status: 'draft' }));
  const res = await POST(makePostRequest(validPostBody()));
  const json = await res.json();
  expect(json.campaign).toBeDefined();
  expect(json.campaign.id).toBe('camp-1');
});

test('GET: DB エラー → 500', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(campaignListChain([], { message: 'DB error' }));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(500);
});

test('POST: POST レートリミット params (5/60s)', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(insertCampaignSingle({ id: 'camp-x' }));
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await POST(makePostRequest(validPostBody()));
  const calls = (checkRateLimit as jest.Mock).mock.calls;
  const postCall = calls.find((c: unknown[]) => c[2] === 5);
  expect(postCall).toBeDefined();
  expect(postCall[3]).toBe(60_000);
});
