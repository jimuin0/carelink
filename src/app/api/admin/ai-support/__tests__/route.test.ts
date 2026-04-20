/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/ai-support
 * Key assertions:
 *   - Facility member only → 401 for non-member
 *   - message min 1, max 1000
 *   - history max 10 entries
 *   - Anthropic API failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

jest.mock('@anthropic-ai/sdk', () => {
  const createFn = jest.fn();
  const MockClass: any = jest.fn(() => ({ messages: { create: createFn } }));
  MockClass._mockCreate = createFn;
  return { __esModule: true, default: MockClass };
});

const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: jest.fn() }),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import Anthropic from '@anthropic-ai/sdk';

function getMockCreate(): jest.Mock {
  return (Anthropic as any)._mockCreate;
}

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/ai-support', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Facility member check: limit(1).single()
function memberSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  getMockCreate().mockResolvedValue({
    content: [{ type: 'text', text: 'AIからの回答です。' }],
  });
});

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest({ message: 'テスト質問' }));
  expect(res.status).toBe(401);
});

test('POST: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest({ message: 'テスト質問' }));
  expect(res.status).toBe(429);
});

test('POST: 非施設メンバー → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await POST(makeRequest({ message: 'テスト質問' }));
  expect(res.status).toBe(401);
});

test('POST: message が空 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ role: 'owner' }));
  const res = await POST(makeRequest({ message: '' }));
  expect(res.status).toBe(400);
});

test('POST: message が 1001 文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ role: 'owner' }));
  const res = await POST(makeRequest({ message: 'a'.repeat(1001) }));
  expect(res.status).toBe(400);
});

test('POST: history が 11 件 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ role: 'owner' }));
  const history = Array.from({ length: 11 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'メッセージ',
  }));
  const res = await POST(makeRequest({ message: 'テスト', history }));
  expect(res.status).toBe(400);
});

test('POST: Anthropic API 失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ role: 'owner' }));
  getMockCreate().mockRejectedValue(new Error('API error'));
  const res = await POST(makeRequest({ message: 'テスト質問' }));
  expect(res.status).toBe(500);
});

test('POST: 正常回答 → 200 with reply', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ role: 'owner' }));
  const res = await POST(makeRequest({ message: 'テスト質問' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.reply).toBe('AIからの回答です。');
});

test('POST: history あり → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ role: 'owner' }));
  const history = [{ role: 'user', content: '前の質問' }, { role: 'assistant', content: '前の回答' }];
  const res = await POST(makeRequest({ message: '続きの質問', history }));
  expect(res.status).toBe(200);
});
