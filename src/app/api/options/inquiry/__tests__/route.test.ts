/**
 * @jest-environment node
 *
 * Tests for POST /api/options/inquiry（contact_only オプションの申込み受付）
 * Key assertions:
 *   - owner/admin 以外 → 403
 *   - contact_only でないオプション → 400
 *   - Slack 通知失敗 → 500（申込みが闇に消えない）
 */

jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: {},
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: jest.fn() }),
}));
jest.mock('@/lib/slack', () => ({ postToSlack: jest.fn() }));
const mockAlertCaughtError = jest.fn();
jest.mock('@/lib/alert', () => ({
  alertCaughtError: (...args: unknown[]) => mockAlertCaughtError(...args),
}));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
let membershipResult: { data: unknown };
let optionResult: { data: unknown };
let facilityResult: { data: unknown };

const makeMaybeSingleChain = (resultRef: () => { data: unknown }) => ({
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  maybeSingle: jest.fn(() => Promise.resolve(resultRef())),
});

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      if (table === 'facility_members') return makeMaybeSingleChain(() => membershipResult);
      if (table === 'option_catalog') return makeMaybeSingleChain(() => optionResult);
      if (table === 'facility_profiles') return makeMaybeSingleChain(() => facilityResult);
      throw new Error(`unexpected table: ${table}`);
    },
    auth: { getUser: mockGetUser },
  }),
}));

import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { postToSlack } from '@/lib/slack';

function makeRequest(body: object = { facilityId: FACILITY_UUID, optionKey: 'hpb_integration' }) {
  return new Request('http://localhost/api/options/inquiry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (postToSlack as jest.Mock).mockResolvedValue({ ok: true });
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  membershipResult = { data: { role: 'owner' } };
  optionResult = { data: { key: 'hpb_integration', name: 'HPB連携', contact_only: true, is_active: true } };
  facilityResult = { data: { name: 'テストサロン' } };
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

test('CSRF 失敗 → その応答を返す', async () => {
  const deny = new Response(JSON.stringify({ error: 'csrf' }), { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValue(deny);
  const res = await POST(makeRequest());
  expect(res.status).toBe(403);
});

test('レートリミット超過 → 429', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValue(true);
  const res = await POST(makeRequest());
  expect(res.status).toBe(429);
});

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest());
  expect(res.status).toBe(401);
});

test('パラメータ不正 → 400', async () => {
  const res = await POST(makeRequest({ facilityId: 'bad', optionKey: 'hpb_integration' }));
  expect(res.status).toBe(400);
});

test('body が JSON でない → 400', async () => {
  const req = new Request('http://localhost/api/options/inquiry', {
    method: 'POST', body: 'not-json',
  }) as unknown as import('next/server').NextRequest;
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('owner/admin でない → 403', async () => {
  membershipResult = { data: null };
  const res = await POST(makeRequest());
  expect(res.status).toBe(403);
});

test('オプションが存在しない → 400', async () => {
  optionResult = { data: null };
  const res = await POST(makeRequest());
  expect(res.status).toBe(400);
});

test('is_active=false → 400', async () => {
  optionResult = { data: { key: 'hpb_integration', name: 'x', contact_only: true, is_active: false } };
  const res = await POST(makeRequest());
  expect(res.status).toBe(400);
});

test('contact_only でない（自動課金対象）→ 400', async () => {
  optionResult = { data: { key: 'reminder_line', name: 'x', contact_only: false, is_active: true } };
  const res = await POST(makeRequest({ facilityId: FACILITY_UUID, optionKey: 'reminder_line' }));
  expect(res.status).toBe(400);
});

test('正常系: Slack に施設名・オプション名を含めて通知し 200', async () => {
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  const text = (postToSlack as jest.Mock).mock.calls[0][0].text as string;
  expect(text).toContain('HPB連携');
  expect(text).toContain('テストサロン');
  expect(text).toContain(FACILITY_UUID);
});

test('施設名が取れない場合はフォールバック表記で通知', async () => {
  facilityResult = { data: null };
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  const text = (postToSlack as jest.Mock).mock.calls[0][0].text as string;
  expect(text).toContain('(名称取得失敗)');
});

test('Slack 通知失敗 → 500（申込みが闇に消えない）', async () => {
  (postToSlack as jest.Mock).mockResolvedValue({ ok: false, error: 'channel_not_found' });
  const res = await POST(makeRequest());
  expect(res.status).toBe(500);
});

test('予期しない例外 → 500＋Slack通知（無音catch根治）', async () => {
  (postToSlack as jest.Mock).mockRejectedValue(new Error('boom'));
  const res = await POST(makeRequest());
  expect(res.status).toBe(500);
  // catch して 500 を返すと onRequestError に伝播せず Slack 通知が漏れるため明示通知する（#490 と同型）。
  expect(mockAlertCaughtError).toHaveBeenCalledWith(
    'options-inquiry',
    expect.any(Error),
    '/api/options/inquiry',
  );
});
