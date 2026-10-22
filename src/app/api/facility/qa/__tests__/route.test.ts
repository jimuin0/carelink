/**
 * @jest-environment node
 *
 * 施設 Q&A への質問（POST /api/facility/qa・2026年10月22日 新設）。
 *
 * 以前は QASection.tsx がブラウザから facility_qa へ直接 INSERT しており、
 *   1. 回答欄・公開フラグ・status までクライアントが決められた（施設名義の偽回答を公開できた）
 *   2. 店舗に何も届かず、質問が誰にも気づかれないまま放置された
 * この経路では保存する値をサーバーが決め、保存できたら店舗へ応答後に知らせる。
 */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(async () => false), mutationRateLimit: null }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
const mockAlert = jest.fn();
jest.mock('@/lib/alert', () => ({ alertCaughtError: (...args: unknown[]) => mockAlert(...args) }));
jest.mock('@/lib/safe', () => ({ ...jest.requireActual('@/lib/safe'), safeCaptureException: jest.fn() }));
const mockNotify = jest.fn();
jest.mock('@/lib/facility-question-notification', () => ({
  notifyFacilityOfNewQuestion: (...args: unknown[]) => mockNotify(...args),
}));
const mockGetUser = jest.fn();
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => ({ auth: { getUser: mockGetUser } }) }));
const mockFacility = jest.fn();
const mockFacilityEq = jest.fn();
const mockInsert = jest.fn();
const mockInsertResult = jest.fn();
const mockFrom = jest.fn((table: string) => {
  if (table === 'facility_profiles') {
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn((column: string, value: unknown) => { mockFacilityEq(column, value); return chain; }),
      maybeSingle: () => mockFacility(),
    };
    return chain;
  }
  return {
    insert: (row: unknown) => {
      mockInsert(table, row);
      return { select: () => ({ single: () => mockInsertResult() }) };
    },
  };
});
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockFrom }) }));

import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

const FACILITY = '74000000-0000-4000-8000-000000000001';
const USER = '74000000-0000-4000-8000-000000000002';
const QA = '74000000-0000-4000-8000-000000000003';

function request(body: unknown = { facility_id: FACILITY, question: '  駐車場はありますか？  ' }) {
  return new Request('http://localhost/api/facility/qa', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  mockFacility.mockResolvedValue({ data: { id: FACILITY, name: '合成鍼灸院' }, error: null });
  mockInsertResult.mockResolvedValue({ data: { id: QA }, error: null });
  mockNotify.mockResolvedValue(undefined);
});

test('質問者はログイン中の本人・回答待ち・回答なしで保存し、店舗へ知らせて 201', async () => {
  const res = await POST(request());
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ success: true, id: QA });
  expect(mockFacilityEq).toHaveBeenCalledWith('id', FACILITY);
  expect(mockFacilityEq).toHaveBeenCalledWith('status', 'published');
  expect(mockInsert).toHaveBeenCalledWith('facility_qa', {
    facility_id: FACILITY, user_id: USER, question: '駐車場はありますか？', status: 'pending', is_public: true,
  });
  expect(mockNotify).toHaveBeenCalledWith({ facilityId: FACILITY, facilityName: '合成鍼灸院', question: '駐車場はありますか？' });
});

test('回答・公開・質問者をクライアントから指定しても使わない（偽回答の回帰）', async () => {
  const res = await POST(request({
    facility_id: FACILITY, question: '保険は使えますか', answer: '全施術が保険適用です', status: 'answered',
    is_public: true, answered_at: '2026-01-01T00:00:00Z', answered_by: USER, user_id: QA,
  }));
  expect(res.status).toBe(201);
  const row = mockInsert.mock.calls[0][1];
  expect(row).toEqual({ facility_id: FACILITY, user_id: USER, question: '保険は使えますか', status: 'pending', is_public: true });
  expect(row).not.toHaveProperty('answer');
  expect(row).not.toHaveProperty('answered_at');
});

test('公開中でない（または存在しない）施設には 404 で、保存も通知もしない', async () => {
  mockFacility.mockResolvedValue({ data: null, error: null });
  const res = await POST(request());
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: '施設が見つかりません' });
  expect(mockInsert).not.toHaveBeenCalled();
  expect(mockNotify).not.toHaveBeenCalled();
});

test('施設の確認に失敗したら「見つからない」と偽らず、通知つきの 500', async () => {
  mockFacility.mockResolvedValue({ data: null, error: { code: '08006', message: 'connection reset' } });
  const res = await POST(request());
  expect(res.status).toBe(500);
  expect(mockAlert).toHaveBeenCalledWith('facility-qa-facility-lookup', new Error('DATABASE_FAILURE:08006'), '/api/facility/qa');
  expect(mockInsert).not.toHaveBeenCalled();
});

test.each([
  ['DB エラー', { data: null, error: { code: '23514', message: 'check violation' } }, new Error('DATABASE_FAILURE:23514')],
  ['行が返らない', { data: null, error: null }, new Error('facility_qa insert returned no row')],
])('保存の失敗（%s）は通知つきの 500 で、店舗へは知らせない', async (_label, result, cause) => {
  mockInsertResult.mockResolvedValue(result);
  const res = await POST(request());
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: '質問の送信に失敗しました。時間をおいて再度お試しください。' });
  expect(mockAlert).toHaveBeenCalledWith('facility-qa-insert', cause, '/api/facility/qa');
  expect(mockNotify).not.toHaveBeenCalled();
});

test.each([
  ['空白だけ', { facility_id: FACILITY, question: '   ' }],
  ['501 文字', { facility_id: FACILITY, question: 'あ'.repeat(501) }],
  ['施設 ID が UUID でない', { facility_id: 'not-a-uuid', question: '質問' }],
  ['JSON でない', 'not-json'],
])('入力の不備（%s）は 400 で、何も保存しない', async (_label, body) => {
  const res = await POST(request(body));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: '質問を1〜500文字で入力してください' });
  expect(mockFrom).not.toHaveBeenCalled();
});

test('500 文字ちょうどは受け付ける（DB の上限と同じ）', async () => {
  const res = await POST(request({ facility_id: FACILITY, question: 'あ'.repeat(500) }));
  expect(res.status).toBe(201);
});

test('1 アカウントの連投は 429（店舗への通知メールを連発させない）', async () => {
  (checkRateLimit as jest.Mock).mockImplementation(async (_l: unknown, key: string, limit: number, windowMs: number, prefix: string) =>
    prefix === 'facility-qa-user' && key === USER && limit === 10 && windowMs === 3_600_000);
  const res = await POST(request());
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ error: '質問の投稿が続いています。しばらくしてからお試しください。' });
  expect(mockFrom).not.toHaveBeenCalled();
});

test('同じ IP からの連投は withRoute のレート制限で 429', async () => {
  (checkRateLimit as jest.Mock).mockImplementation(async (_l: unknown, _k: string, limit: number, _w: number, prefix: string) =>
    prefix === 'facility-qa' && limit === 5);
  const res = await POST(request());
  expect(res.status).toBe(429);
  expect(mockFrom).not.toHaveBeenCalled();
});

test('ログインしていなければ 401 で、何も保存しない', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  const res = await POST(request());
  expect(res.status).toBe(401);
  expect(mockFrom).not.toHaveBeenCalled();
});

test('別オリジンからの送信は CSRF で 403', async () => {
  (checkCsrf as jest.Mock).mockReturnValue(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
  const res = await POST(request());
  expect(res.status).toBe(403);
  expect(mockFrom).not.toHaveBeenCalled();
});
