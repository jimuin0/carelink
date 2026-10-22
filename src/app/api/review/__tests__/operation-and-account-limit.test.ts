/**
 * @jest-environment node
 *
 * POST /api/review（2026年10月23日）
 *  1. ログイン中は「同じ施設へ 24 時間に 1 件」をアカウントでも数える。以前は IP だけで判定しており、
 *     回線を切り替えるだけで同じアカウントから「来店確認済み」の口コミを何件でも重ねられた。
 *  2. 送信結果が分からなかった投稿は同じ操作 ID で送り直せる。保存済みならその口コミを返し、
 *     新しい口コミは作らない（以前はフォームが端末で永久にロックされていた）。
 *  3. トリガが 24 時間の重複で巻き戻した投稿は「保存していない」と確定しているので、
 *     X-CareLink-Review-Commit: not-started を付ける（以前は付かず、フォームが永久にロックされた）。
 */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => false, mutationRateLimit: null }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: () => null }));
jest.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }));
const mockUser: { current: { id: string } | null } = { current: { id: '78000000-0000-4000-8000-000000000001' } };
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: mockUser.current }, error: null }) } }) }));
const mockSettings = { pushOnReview: false, emailOnReview: false };
jest.mock('@/lib/notification-settings', () => ({ getFacilityNotificationSettings: async () => mockSettings }));
const mockPush = jest.fn(async () => undefined);
jest.mock('@/lib/push', () => ({ sendPushToFacilityOwners: (...args: unknown[]) => (mockPush as jest.Mock)(...args) }));
const mockEmail = jest.fn(async () => true);
jest.mock('@/lib/email', () => ({ sendNewReviewNotification: (...args: unknown[]) => (mockEmail as jest.Mock)(...args) }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));

const FACILITY = '78000000-0000-4000-8000-000000000002';
const OTHER_FACILITY = '78000000-0000-4000-8000-000000000003';
const OPERATION = '78000000-0000-4000-8000-000000000009';
const EARLIER = '78000000-0000-4000-8000-000000000010';
const CREATED = '78000000-0000-4000-8000-000000000011';
const USER = '78000000-0000-4000-8000-000000000001';
const OTHER_USER = '78000000-0000-4000-8000-000000000012';

type Result = { data: unknown; error: unknown };
let recentBy: Record<string, Result>;
let operationLookups: Result[];
let legacyLookup: Result;
const legacyFilters: Record<string, unknown>[] = [];
let insertResult: Result;
const mockInsert = jest.fn();
const duplicateQueries: string[] = [];

jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (column: string, value: unknown) => { filters[column] = value; return chain; };
    chain.in = () => Promise.resolve({ data: table === 'profiles' ? [{ email: 'owner@example.invalid' }] : [{ user_id: 'owner-1' }], error: null });
    chain.gte = (column: string, value: unknown) => { if (column === 'created_at' && 'client_operation_id' in filters) filters.since = value; return chain; };
    chain.is = (column: string, value: unknown) => { filters[column] = value; return chain; };
    chain.order = () => chain;
    chain.single = () => Promise.resolve({ data: { name: '合成サロン' }, error: null });
    chain.limit = () => {
      if (table === 'bookings') return Promise.resolve({ data: [], error: null });
      if ('client_operation_id' in filters) { legacyFilters.push({ ...filters }); return Promise.resolve(legacyLookup); }
      const column = 'user_id' in filters ? 'user_id' : 'reviewer_ip';
      duplicateQueries.push(column);
      return Promise.resolve(recentBy[column]);
    };
    chain.maybeSingle = () => Promise.resolve(operationLookups.shift() ?? { data: null, error: null });
    chain.insert = (row: unknown) => { mockInsert(row); return { select: () => ({ single: () => Promise.resolve(insertResult) }) }; };
    return chain;
  },
}) }));

import { POST } from '../route';

const base = { facility_id: FACILITY, reviewer_name: '合成', rating_skill: 4, rating_service: 4, rating_atmosphere: 4, rating_cleanliness: 4, rating_explanation: 4 };
const request = (body: Record<string, unknown>, ip = '198.51.100.7') => new Request('http://localhost/api/review', {
  method: 'POST', headers: { 'X-CareLink-Review-Consumer': '1', 'x-real-ip': ip }, body: JSON.stringify(body),
});

beforeEach(() => {
  jest.clearAllMocks();
  duplicateQueries.length = 0;
  mockUser.current = { id: USER };
  mockSettings.pushOnReview = false;
  mockSettings.emailOnReview = false;
  recentBy = { reviewer_ip: { data: [], error: null }, user_id: { data: [], error: null } };
  operationLookups = [];
  legacyLookup = { data: [], error: null };
  legacyFilters.length = 0;
  insertResult = { data: { id: CREATED }, error: null };
  delete process.env.RECAPTCHA_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
});

describe('24 時間の重複はアカウントでも数える', () => {
  test('ログイン中に別の回線から送っても、同じアカウントの投稿があれば 429（保存しない）', async () => {
    recentBy.user_id = { data: [{ id: EARLIER }], error: null };
    const response = await POST(request(base, '203.0.113.99'));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: 'REVIEW_RECENT_DUPLICATE', error: '同じ施設への口コミは24時間に1回までです' });
    expect(response.headers.get('X-CareLink-Review-Commit')).toBe('not-started');
    expect(duplicateQueries.sort()).toEqual(['reviewer_ip', 'user_id']);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('未ログインは IP だけで判定する（アカウントの確認をしない）', async () => {
    mockUser.current = null;
    const response = await POST(request(base));
    expect(response.status).toBe(200);
    expect(duplicateQueries).toEqual(['reviewer_ip']);
  });

  test('同じ IP の投稿があれば従来どおり 429', async () => {
    mockUser.current = null;
    recentBy.reviewer_ip = { data: [{ id: EARLIER }], error: null };
    expect((await POST(request(base))).status).toBe(429);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('アカウント側の確認に失敗したら 500（重複の許可にしない）', async () => {
    recentBy.user_id = { data: null, error: { message: 'synthetic' } };
    const response = await POST(request(base));
    expect(response.status).toBe(500);
    expect(response.headers.get('X-CareLink-Review-Commit')).toBe('not-started');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('確認の応答に行が無い（data が null）なら重複なしとして投稿する', async () => {
    recentBy.user_id = { data: null, error: null };
    expect((await POST(request(base))).status).toBe(200);
  });

  test('トリガが重複で巻き戻した投稿は「保存していない」と確定させる（not-started）', async () => {
    insertResult = { data: null, error: { code: 'P0001', message: 'REVIEW_RECENT_DUPLICATE' } };
    const response = await POST(request(base));
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('REVIEW_RECENT_DUPLICATE');
    expect(response.headers.get('X-CareLink-Review-Commit')).toBe('not-started');
  });
});

describe('操作 ID による二重投稿なしのやり直し', () => {
  test('新しい操作 ID は口コミと一緒に保存する', async () => {
    const response = await POST(request({ ...base, operation_id: OPERATION }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, id: CREATED });
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ client_operation_id: OPERATION }));
  });

  test('操作 ID を送らない旧フォームは列を書かない', async () => {
    await POST(request(base));
    expect(mockInsert.mock.calls[0][0]).not.toHaveProperty('client_operation_id');
  });

  test('前回の送信が保存済みなら、その口コミを返し新しい口コミを作らない（重複の確認より先）', async () => {
    operationLookups = [{ data: { id: EARLIER, facility_id: FACILITY, user_id: USER }, error: null }];
    recentBy.user_id = { data: [{ id: EARLIER }], error: null };
    mockSettings.pushOnReview = true;
    const response = await POST(request({ ...base, operation_id: OPERATION }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, id: EARLIER, replayed: true });
    expect(response.headers.get('X-CareLink-Review-Commit')).toBeNull();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(duplicateQueries).toEqual([]);
    expect(mockPush).not.toHaveBeenCalled();
  });

  test('別の施設の操作 ID は 409（保存しない）', async () => {
    operationLookups = [{ data: { id: EARLIER, facility_id: OTHER_FACILITY, user_id: USER }, error: null }];
    const response = await POST(request({ ...base, operation_id: OPERATION }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('REVIEW_OPERATION_CONFLICT');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('前回の受付状況を確認できなければ 500（推測で保存しない）', async () => {
    operationLookups = [{ data: null, error: { message: 'synthetic' } }];
    const response = await POST(request({ ...base, operation_id: OPERATION }));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('前回の投稿の受付状況を確認できません');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('並んで届いた同じ操作 ID（一意制約違反）は先に保存された口コミを返す', async () => {
    operationLookups = [{ data: null, error: null }, { data: { id: EARLIER, facility_id: FACILITY, user_id: USER }, error: null }];
    insertResult = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_facility_reviews_client_operation"' } };
    const response = await POST(request({ ...base, operation_id: OPERATION }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, id: EARLIER, replayed: true });
  });

  test('トリガの重複でも、同じ操作 ID が保存済みならその口コミを返す', async () => {
    operationLookups = [{ data: null, error: null }, { data: { id: EARLIER, facility_id: FACILITY, user_id: USER }, error: null }];
    insertResult = { data: null, error: { code: 'P0001', message: 'REVIEW_RECENT_DUPLICATE' } };
    const response = await POST(request({ ...base, operation_id: OPERATION }));
    expect(await response.json()).toEqual({ success: true, id: EARLIER, replayed: true });
  });

  test('トリガの重複で、操作 ID の口コミが無ければ 429（not-started）', async () => {
    operationLookups = [{ data: null, error: null }, { data: null, error: null }];
    insertResult = { data: null, error: { code: 'P0001', message: 'REVIEW_RECENT_DUPLICATE' } };
    const response = await POST(request({ ...base, operation_id: OPERATION }));
    expect(response.status).toBe(429);
    expect(response.headers.get('X-CareLink-Review-Commit')).toBe('not-started');
  });

  test('一意制約違反の後に口コミを確かめられなければ、結果不明の 500（not-started を付けない）', async () => {
    operationLookups = [{ data: null, error: null }, { data: { id: EARLIER, facility_id: OTHER_FACILITY, user_id: USER }, error: null }];
    insertResult = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_facility_reviews_client_operation"' } };
    const response = await POST(request({ ...base, operation_id: OPERATION }));
    expect(response.status).toBe(500);
    expect(response.headers.get('X-CareLink-Review-Commit')).toBeNull();
  });

  test('別の一意制約違反は操作 ID の再確認をせず、結果不明の 500', async () => {
    operationLookups = [{ data: null, error: null }];
    insertResult = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "facility_reviews_pkey"' } };
    const response = await POST(request({ ...base, operation_id: OPERATION }));
    expect(response.status).toBe(500);
    expect(operationLookups).toHaveLength(0);
    expect(response.headers.get('X-CareLink-Review-Commit')).toBeNull();
  });

  test('操作 ID なしの一意制約違反も結果不明の 500', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'uq_facility_reviews_client_operation' } };
    expect((await POST(request(base))).status).toBe(500);
  });
});

// 2026年10月23日レビュー指摘: 端末の印はログアウト・退会の後も残す（共有端末）。別のアカウントの印で
// 送り直されたときに前回の口コミを返すと、今回の投稿が捨てられ、他人の投稿の ID まで伝わっていた。
describe('操作 ID の送り直しは同じ投稿者だけに前回の口コミを返す', () => {
  const OTHER_ACCOUNT = { code: 'REVIEW_OPERATION_OTHER_ACCOUNT', error: '今回の内容はまだ投稿していません。この端末に残っていた、別のログイン状態での送信記録を整理しました。もう一度「口コミを投稿する」を押してください。' };

  test('別のアカウントの口コミだった操作 ID は保存前に断り、前回の口コミの ID を返さない', async () => {
    operationLookups = [{ data: { id: EARLIER, facility_id: FACILITY, user_id: OTHER_USER }, error: null }];
    const response = await POST(request({ ...base, operation_id: OPERATION }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(OTHER_ACCOUNT);
    expect(response.headers.get('X-CareLink-Review-Commit')).toBe('not-started');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('ログイン中の会員の印を、ログアウト後（未ログイン）に送り直しても前回の口コミを返さない', async () => {
    mockUser.current = null;
    operationLookups = [{ data: { id: EARLIER, facility_id: FACILITY, user_id: USER }, error: null }];
    const response = await POST(request({ ...base, operation_id: OPERATION }));
    expect(await response.json()).toEqual(OTHER_ACCOUNT);
  });

  test('未ログイン同士は前回の口コミを返す', async () => {
    mockUser.current = null;
    operationLookups = [{ data: { id: EARLIER, facility_id: FACILITY, user_id: null }, error: null }];
    expect(await (await POST(request({ ...base, operation_id: OPERATION }))).json()).toEqual({ success: true, id: EARLIER, replayed: true });
  });

  test('未ログインの並んで届いた送信は、未ログインの前回の口コミを返す', async () => {
    mockUser.current = null;
    operationLookups = [{ data: null, error: null }, { data: { id: EARLIER, facility_id: FACILITY, user_id: null }, error: null }];
    insertResult = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_facility_reviews_client_operation"' } };
    expect(await (await POST(request({ ...base, operation_id: OPERATION }))).json()).toEqual({ success: true, id: EARLIER, replayed: true });
  });

  test('並んで届いた送信の一意制約違反でも、別のアカウントの口コミなら返さず保存前の拒否にする', async () => {
    operationLookups = [{ data: null, error: null }, { data: { id: EARLIER, facility_id: FACILITY, user_id: OTHER_USER }, error: null }];
    insertResult = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_facility_reviews_client_operation"' } };
    const response = await POST(request({ ...base, operation_id: OPERATION }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(OTHER_ACCOUNT);
    expect(response.headers.get('X-CareLink-Review-Commit')).toBe('not-started');
  });
});

// 2026年10月23日レビュー指摘: 旧フォームの印（操作 ID を送っていなかった頃のもの）は、サーバーが
// その ID を知らない。24 時間を過ぎてから・IP が変わってから送り直すと、保存済みだった前回の口コミと
// 同じ口コミがもう 1 件作られていた。
describe('旧フォームの印の送り直し', () => {
  test('ログイン中は同じアカウントの旧フォームの口コミを前回の口コミとして返す（新しく作らない）', async () => {
    legacyLookup = { data: [{ id: EARLIER }], error: null };
    const response = await POST(request({ ...base, operation_id: OPERATION, legacy_operation: true }));
    expect(await response.json()).toEqual({ success: true, id: EARLIER, replayed: true });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(legacyFilters).toEqual([{ facility_id: FACILITY, user_id: USER, client_operation_id: null, since: '2026-10-11T00:00:00+09:00' }]);
  });

  test('未ログインは同じ IP の未ログインの口コミで探す', async () => {
    mockUser.current = null;
    legacyLookup = { data: [{ id: EARLIER }], error: null };
    expect(await (await POST(request({ ...base, operation_id: OPERATION, legacy_operation: true }))).json()).toEqual({ success: true, id: EARLIER, replayed: true });
    expect(legacyFilters).toEqual([{ facility_id: FACILITY, reviewer_ip: '198.51.100.7', user_id: null, client_operation_id: null, since: '2026-10-11T00:00:00+09:00' }]);
  });

  test('前回の口コミが無ければ、その操作 ID で今回の内容を保存する', async () => {
    const response = await POST(request({ ...base, operation_id: OPERATION, legacy_operation: true }));
    expect(await response.json()).toEqual({ success: true, id: CREATED });
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ client_operation_id: OPERATION }));
  });

  test('応答に行が無い（data が null）ときも前回の口コミは無いとして保存する', async () => {
    legacyLookup = { data: null, error: null };
    expect((await POST(request({ ...base, operation_id: OPERATION, legacy_operation: true }))).status).toBe(200);
  });

  test('前回の口コミを確かめられなければ 500（推測で保存しない）', async () => {
    legacyLookup = { data: null, error: { message: 'synthetic' } };
    const response = await POST(request({ ...base, operation_id: OPERATION, legacy_operation: true }));
    expect(response.status).toBe(500);
    expect(response.headers.get('X-CareLink-Review-Commit')).toBe('not-started');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('操作 ID で前回の口コミが見つかれば、旧フォームの探索はしない', async () => {
    operationLookups = [{ data: { id: EARLIER, facility_id: FACILITY, user_id: USER }, error: null }];
    await POST(request({ ...base, operation_id: OPERATION, legacy_operation: true }));
    expect(legacyFilters).toEqual([]);
  });

  test('新しいフォームの送り直し（legacy_operation なし）は旧フォームの探索をしない', async () => {
    await POST(request({ ...base, operation_id: OPERATION }));
    expect(legacyFilters).toEqual([]);
  });

  test('legacy_operation は true 以外を受け付けない', async () => {
    expect((await POST(request({ ...base, operation_id: OPERATION, legacy_operation: false }))).status).toBe(400);
  });
});

describe('店舗への通知に審査待ちを書き添える', () => {
  test('禁止表現を含む口コミは Push とメールに「運営の確認後に公開」を添える', async () => {
    mockSettings.pushOnReview = true;
    mockSettings.emailOnReview = true;
    expect((await POST(request({ ...base, comment: '日本一の美容師さんです' }))).status).toBe(200);
    expect(mockPush).toHaveBeenCalledWith(FACILITY, expect.objectContaining({ body: expect.stringContaining('（運営の確認後に公開されます）') }));
    expect(mockEmail).toHaveBeenCalledWith(expect.objectContaining({ facilityEmail: 'owner@example.invalid', pendingModeration: true }));
  });

  test('通常の口コミには添えない', async () => {
    mockSettings.pushOnReview = true;
    mockSettings.emailOnReview = true;
    expect((await POST(request({ ...base, comment: 'とても丁寧でした' }))).status).toBe(200);
    expect(mockPush).toHaveBeenCalledWith(FACILITY, expect.objectContaining({ body: expect.not.stringContaining('運営の確認') }));
    expect(mockEmail).toHaveBeenCalledWith(expect.objectContaining({ pendingModeration: false }));
  });
});
