/**
 * @jest-environment node
 *
 * GET /api/options/catalog — 施設に見せる有料オプション一覧。
 *
 * 【2026年7月30日 新設の理由・本番実測】
 * 従来は管理画面のクライアントが option_catalog を直接読み、is_active=true の4件を
 * 値札と購入ボタン付きで並べていた。しかし本番に STRIPE_SECRET_KEY は無く、購入すると
 * /api/options/checkout が 503「決済機能が設定されていません」を返していた。
 * 買えない商品に値段を出して押させる状態だったため、購入可否を決める同じ変数を
 * サーバで見て、購入必須のオプションはそもそも返さないようにした。
 * contact_only（HPB 連携など）は決済を通さず Slack へ申込みが飛ぶ運用のため残す。
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));

import { checkRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

const PAID = { key: 'reminder_email_3d', name: '3日前リマインドメール', description: null, monthly_price: 500, contact_only: false, sort_order: 1 };
const PAID2 = { key: 'reminder_line', name: '7日前リマインドLINE', description: null, monthly_price: 1500, contact_only: false, sort_order: 2 };
const CONTACT = { key: 'hpb_integration', name: 'HPB連携', description: null, monthly_price: 3000, contact_only: true, sort_order: 3 };

function setupSupabase(result: { data?: unknown; error?: unknown }) {
  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  createServerSupabaseClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null }),
        }),
      }),
    }),
  });
}

function req() {
  return new Request('http://localhost/api/options/catalog', { headers: { 'x-forwarded-for': '203.0.113.1' } });
}

const originalStripe = process.env.STRIPE_SECRET_KEY;

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  setupSupabase({ data: [PAID, PAID2, CONTACT] });
});

afterEach(() => {
  if (originalStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalStripe;
});

test('決済未設定 → 購入必須オプションを返さない（買えない商品を見せない）', async () => {
  delete process.env.STRIPE_SECRET_KEY;
  const json = await (await GET(req())).json();
  expect(json.paymentsEnabled).toBe(false);
  expect(json.options.map((o: { key: string }) => o.key)).toEqual(['hpb_integration']);
});

test('決済未設定でも contact_only は返す（Slack 申込みで成立するため）', async () => {
  delete process.env.STRIPE_SECRET_KEY;
  const json = await (await GET(req())).json();
  expect(json.options).toHaveLength(1);
  expect(json.options[0].contact_only).toBe(true);
});

test('決済設定済み → 全オプションを返す（鍵を入れた瞬間に自動で復活する）', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  const json = await (await GET(req())).json();
  expect(json.paymentsEnabled).toBe(true);
  expect(json.options.map((o: { key: string }) => o.key)).toEqual([
    'reminder_email_3d', 'reminder_line', 'hpb_integration',
  ]);
});

test('data が null でも空配列として扱う（0件と障害を混同しない）', async () => {
  delete process.env.STRIPE_SECRET_KEY;
  setupSupabase({ data: null });
  const res = await GET(req());
  expect(res.status).toBe(200);
  expect((await res.json()).options).toEqual([]);
});

// 取得失敗を空配列に化けさせると「オプションが1つも無い」と見分けがつかず障害が無音になる。
test('取得失敗 → 500（空配列に偽装しない）', async () => {
  setupSupabase({ error: { message: 'boom' } });
  const res = await GET(req());
  expect(res.status).toBe(500);
  const { safeCaptureException } = require('@/lib/safe');
  const { alertCaughtError } = require('@/lib/alert');
  expect(safeCaptureException).toHaveBeenCalled();
  expect(alertCaughtError).toHaveBeenCalled();
});

test('レート制限 → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  expect((await GET(req())).status).toBe(429);
});

test('例外 → 500 に変換し通知する', async () => {
  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  createServerSupabaseClient.mockImplementation(() => { throw new Error('boom'); });
  const res = await GET(req());
  expect(res.status).toBe(500);
  const { alertCaughtError } = require('@/lib/alert');
  expect(alertCaughtError).toHaveBeenCalled();
});
