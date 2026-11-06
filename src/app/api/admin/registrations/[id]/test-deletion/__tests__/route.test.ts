/** @jest-environment node */
const mockGetUser = jest.fn();
const mockRpc = jest.fn();
const mockRemove = jest.fn();
const mockList = jest.fn();
const mockFrom = jest.fn(() => ({ remove: mockRemove, list: mockList }));
const mockCapture = jest.fn();
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ rpc: mockRpc, storage: { from: mockFrom } }) }));
jest.mock('@/lib/safe', () => ({ ...jest.requireActual('@/lib/safe'), safeCaptureMessage: (...args: unknown[]) => mockCapture(...args) }));
import { POST } from '../route';
const actor = '74000000-0000-4000-8000-000000000001';
const id = '74000000-0000-4000-8000-000000000002';
const facility = '74000000-0000-4000-8000-000000000003';
const body = { expected_name: '合成テスト店' };
function request(value: unknown = body, origin = 'http://localhost', target = id) {
  return new Request(`http://localhost/api/admin/registrations/${target}/test-deletion`, { method: 'POST', headers: { origin, host: 'localhost', 'content-type': 'application/json' }, body: JSON.stringify(value) });
}
beforeEach(() => {
  jest.clearAllMocks(); process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  mockGetUser.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  mockRpc.mockResolvedValue({ data: { outcome: 'deleted', facility_id: facility, upload_paths: ['salon-intents/a.jpg'] }, error: null });
  mockRemove.mockResolvedValue({ data: [], error: null });
  mockList.mockResolvedValue({ data: [{ name: 'b.jpg' }], error: null });
});
test('確定した削除は、実行者を渡し、写真のファイルも消す', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ success: true, filesRemoved: true });
  expect(mockRpc).toHaveBeenCalledWith('delete_test_registration', { p_actor: actor, p_salon: id, p_expected_name: '合成テスト店' });
  expect(mockFrom).toHaveBeenCalledWith('carelink-uploads');
  expect(mockRemove).toHaveBeenCalledWith(['salon-intents/a.jpg']);
  expect(mockList).toHaveBeenCalledWith(`facilities/${facility}`, { limit: 1000 });
  expect(mockRemove).toHaveBeenCalledWith([`facilities/${facility}/b.jpg`]);
});
test('店舗も写真も無い申込は、ファイルに触らない', async () => {
  mockRpc.mockResolvedValue({ data: { outcome: 'deleted', facility_id: null, upload_paths: [] }, error: null });
  expect(await (await POST(request())).json()).toEqual({ success: true, filesRemoved: true });
  expect(mockFrom).not.toHaveBeenCalled();
});
test('店舗に写真が無いときは、消す呼び出しをしない', async () => {
  mockRpc.mockResolvedValue({ data: { outcome: 'deleted', facility_id: facility }, error: null });
  mockList.mockResolvedValue({ data: [], error: null });
  expect(await (await POST(request())).json()).toEqual({ success: true, filesRemoved: true });
  expect(mockRemove).not.toHaveBeenCalled();
});
test.each([
  ['アップロードの削除に失敗', () => mockRemove.mockResolvedValueOnce({ data: null, error: { message: 'private' } })],
  ['店舗の写真の一覧に失敗', () => mockList.mockResolvedValueOnce({ data: null, error: { message: 'private' } })],
  ['店舗の写真の削除に失敗', () => mockRemove.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: { message: 'private' } })],
  ['ストレージが例外', () => mockList.mockRejectedValueOnce(new Error('private'))],
])('%s：申込は消えているので成功を返し、ファイルが残ったことを伝える', async (_name, arrange) => {
  arrange();
  const response = await POST(request());
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(JSON.parse(text)).toEqual({ success: true, filesRemoved: false });
  expect(text).not.toContain('private');
  expect(mockCapture).toHaveBeenCalledTimes(1);
});
test('未ログイン・別サイトからは消せない', async () => {
  mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
  expect((await POST(request())).status).toBe(401);
  expect((await POST(request(body, 'https://elsewhere.invalid'))).status).toBe(403);
  expect(mockRpc).not.toHaveBeenCalled();
});
test.each([null, {}, { expected_name: '' }, { expected_name: 1 }, { ...body, extra: true }])('不正な入力では消さない %#', async value => {
  expect((await POST(request(value))).status).toBe(400); expect(mockRpc).not.toHaveBeenCalled();
});
test('不正な受付番号では消さない', async () => {
  expect((await POST(request(body, 'http://localhost', 'bad'))).status).toBe(400); expect(mockRpc).not.toHaveBeenCalled();
});
test.each([
  ['not_found', 'すでにありません'], ['changed', '店舗名が変わって'], ['not_test', 'テスト・検証用'],
  ['facility_not_draft', '公開中または停止中'], ['has_activity', '予約・顧客'], ['delivery_in_progress', '送信待ち'],
])('DB が断った %s は 409 で理由を返し、ファイルに触らない', async (outcome, message) => {
  mockRpc.mockResolvedValue({ data: { outcome }, error: null });
  const response = await POST(request());
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain(message);
  expect(mockFrom).not.toHaveBeenCalled();
});
test('運営でなくなった人は DB が断る', async () => {
  mockRpc.mockResolvedValue({ data: { outcome: 'forbidden' }, error: null });
  expect((await POST(request())).status).toBe(403);
});
test('DB が入力不正と返したら 400', async () => {
  mockRpc.mockResolvedValue({ data: { outcome: 'invalid' }, error: null });
  expect((await POST(request())).status).toBe(400);
});
test.each([{ data: null, error: null }, { data: { outcome: 'deleted', extra: 1 }, error: null }, { data: null, error: { message: 'private' } }])('壊れた応答・失敗は成功にしない %#', async value => {
  mockRpc.mockResolvedValue(value);
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('private');
  expect(mockFrom).not.toHaveBeenCalled();
});
