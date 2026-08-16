/**
 * @jest-environment node
 *
 * PATCH /api/admin/platform-blog/[id] の description/category/content 部分更新分岐（route.ts 61-63行目）を検証する。
 *
 * zod スキーマは description/category を .optional().nullable() にしているため、リクエストは
 *   - 未指定（undefined） … 更新対象に含めない
 *   - 明示 null            … 空文字（''）へクリア
 *   - 文字列値              … その値をそのまま設定
 * の3通りが来うる。content は .optional() のみ（null は許容しない）なので
 *   - 未指定（undefined） … 更新対象に含めない
 *   - 配列値                … その値をそのまま設定
 * の2通り。route.ts が組み立てる updatePayload が、この分岐どおりに動くことを検証する。
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const POST_UUID = '11111111-1111-1111-1111-111111111111';
const USER_ID   = '33333333-3333-3333-3333-333333333333';

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
import { PATCH } from '../route';

function makeProps(id = POST_UUID) {
  return { params: Promise.resolve({ id }) };
}

function makePatchRequest(body: object) {
  return new NextRequest(`http://localhost/api/admin/platform-blog/${POST_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function profileSingle(isAdmin: boolean) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: { is_platform_admin: isAdmin }, error: null })),
  };
}

// update() に渡された値（updatePayload）を捕捉するための admin.from() モック。
function capturingAdminFrom(captured: { value?: Record<string, unknown> }) {
  return {
    update: jest.fn((u: Record<string, unknown>) => {
      captured.value = u;
      return {
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            maybeSingle: jest.fn(() => Promise.resolve({ data: { id: POST_UUID }, error: null })),
          }),
        }),
      };
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockAnonFrom.mockReturnValue(profileSingle(true));
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── description ────────────────────────────────────────────────────────────

test('PATCH: description に文字列値 → updatePayload.description がその値になる', async () => {
  const captured: { value?: Record<string, unknown> } = {};
  mockAdminFrom.mockReturnValue(capturingAdminFrom(captured));
  const res = await PATCH(makePatchRequest({ description: '新しい説明文' }), makeProps());
  expect(res.status).toBe(200);
  expect(captured.value?.description).toBe('新しい説明文');
});

test('PATCH: description に明示 null → updatePayload.description が空文字にクリアされる', async () => {
  const captured: { value?: Record<string, unknown> } = {};
  mockAdminFrom.mockReturnValue(capturingAdminFrom(captured));
  const res = await PATCH(makePatchRequest({ description: null }), makeProps());
  expect(res.status).toBe(200);
  expect(captured.value?.description).toBe('');
});

test('PATCH: description 未指定 → updatePayload に description キーが含まれない', async () => {
  const captured: { value?: Record<string, unknown> } = {};
  mockAdminFrom.mockReturnValue(capturingAdminFrom(captured));
  const res = await PATCH(makePatchRequest({ title: 'タイトルのみ更新' }), makeProps());
  expect(res.status).toBe(200);
  expect(captured.value).not.toHaveProperty('description');
});

// ─── category ───────────────────────────────────────────────────────────────

test('PATCH: category に文字列値 → updatePayload.category がその値になる', async () => {
  const captured: { value?: Record<string, unknown> } = {};
  mockAdminFrom.mockReturnValue(capturingAdminFrom(captured));
  const res = await PATCH(makePatchRequest({ category: 'お知らせ' }), makeProps());
  expect(res.status).toBe(200);
  expect(captured.value?.category).toBe('お知らせ');
});

test('PATCH: category に明示 null → updatePayload.category が空文字にクリアされる', async () => {
  const captured: { value?: Record<string, unknown> } = {};
  mockAdminFrom.mockReturnValue(capturingAdminFrom(captured));
  const res = await PATCH(makePatchRequest({ category: null }), makeProps());
  expect(res.status).toBe(200);
  expect(captured.value?.category).toBe('');
});

test('PATCH: category 未指定 → updatePayload に category キーが含まれない', async () => {
  const captured: { value?: Record<string, unknown> } = {};
  mockAdminFrom.mockReturnValue(capturingAdminFrom(captured));
  const res = await PATCH(makePatchRequest({ title: 'タイトルのみ更新' }), makeProps());
  expect(res.status).toBe(200);
  expect(captured.value).not.toHaveProperty('category');
});

// ─── content ────────────────────────────────────────────────────────────────

test('PATCH: content に配列値 → updatePayload.content がその値になる', async () => {
  const captured: { value?: Record<string, unknown> } = {};
  mockAdminFrom.mockReturnValue(capturingAdminFrom(captured));
  const contentValue = [{ type: 'paragraph', text: '本文です' }];
  const res = await PATCH(makePatchRequest({ content: contentValue }), makeProps());
  expect(res.status).toBe(200);
  expect(captured.value?.content).toEqual(contentValue);
});

test('PATCH: content 未指定 → updatePayload に content キーが含まれない', async () => {
  const captured: { value?: Record<string, unknown> } = {};
  mockAdminFrom.mockReturnValue(capturingAdminFrom(captured));
  const res = await PATCH(makePatchRequest({ title: 'タイトルのみ更新' }), makeProps());
  expect(res.status).toBe(200);
  expect(captured.value).not.toHaveProperty('content');
});

// ─── 複合ケース（description/category/content を同時指定） ──────────────────

test('PATCH: description/category/content を同時に指定 → 3つとも updatePayload に反映される', async () => {
  const captured: { value?: Record<string, unknown> } = {};
  mockAdminFrom.mockReturnValue(capturingAdminFrom(captured));
  const contentValue = [{ type: 'heading', text: '見出し' }];
  const res = await PATCH(
    makePatchRequest({ description: '説明', category: 'カテゴリ', content: contentValue }),
    makeProps()
  );
  expect(res.status).toBe(200);
  expect(captured.value?.description).toBe('説明');
  expect(captured.value?.category).toBe('カテゴリ');
  expect(captured.value?.content).toEqual(contentValue);
});
