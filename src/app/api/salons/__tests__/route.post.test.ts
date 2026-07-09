/**
 * @jest-environment node
 *
 * Tests for POST /api/salons (施設掲載の唯一の登録経路)
 * Key assertions:
 *   - CSRF check required (withRoute csrf:true)
 *   - Rate limiting (5 req/min per IP, prefix 'salon-register')
 *   - Schema validation (required fields, email/phone format, max lengths, ranges)
 *   - Photo URL provenance restriction (only own Supabase Storage public bucket)
 *   - service_role insert → returns { success, id }
 *   - Insert error / exception → 500
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: 'mutationLimit',
  checkRateLimit: jest.fn(),
}));
jest.mock('@supabase/supabase-js');

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

const STORAGE_PREFIX =
  'https://test.supabase.co/storage/v1/object/public/carelink-uploads/';

let mockInsert: jest.Mock;
let mockSingle: jest.Mock;

function setupDefaultMocks(opts: { insertError?: boolean; noData?: boolean } = {}) {
  (checkCsrf as jest.Mock).mockReturnValue(null);

  mockSingle = jest.fn().mockResolvedValue({
    data: opts.noData ? null : { id: 'new-salon-id' },
    error: opts.insertError ? { message: 'Insert failed' } : null,
  });
  mockInsert = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({ single: mockSingle }),
  });

  const { createClient } = require('@supabase/supabase-js');
  createClient.mockReturnValue({
    from: jest.fn().mockReturnValue({ insert: mockInsert }),
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  setupDefaultMocks();
});

const validFull = {
  facility_name: 'リラクサロン ABC',
  business_type: 'エステサロン',
  representative_name: '山田 太郎',
  contact_name: '山田 花子',
  email: 'owner@example.com',
  phone: '090-1234-5678',
  contact_phone: '06-1234-5678',
  website: 'https://example.com',
  postal_code: '5600001',
  address: '大阪府堺市堺区',
  building_name: 'ABCビル 3F',
  nearest_station: '堺東駅 徒歩5分',
  business_hours: '10:00〜20:00',
  regular_holiday: '毎週月曜日',
  seat_count: 5,
  staff_count: 3,
  has_parking: true,
  features: ['駐車場あり', '個室あり'],
  pr_text: 'PRテキスト',
  photo_url: `${STORAGE_PREFIX}salons/uuid/exterior.jpg`,
  photo_urls: [`${STORAGE_PREFIX}salons/uuid/exterior.jpg`],
  desired_start_date: 'immediately',
};

const validMinimal = {
  facility_name: '○○鍼灸院',
  business_type: '鍼灸院・整骨院',
  representative_name: '佐藤 一郎',
  contact_name: '佐藤 次郎',
  email: 'clinic@example.com',
  phone: '0312345678',
  postal_code: null,
  address: null,
  website: null,
  pr_text: null,
};

function makeRequest(body: unknown, ip = '192.168.1.1') {
  return new Request('http://localhost/api/salons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

describe('POST /api/salons', () => {
  test('CSRF check failed → 403', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError as any);

    const res = await POST(makeRequest(validFull) as any);
    expect(res.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest(validFull) as any);
    expect(res.status).toBe(429);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('rate limit configured with salon-register prefix, limit 5', async () => {
    await POST(makeRequest(validFull) as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(5);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('salon-register');
  });

  test('valid full payload → 200 with id', async () => {
    const res = await POST(makeRequest(validFull) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.id).toBe('new-salon-id');
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  test('valid minimal payload (recruit subset) → 200', async () => {
    const res = await POST(makeRequest(validMinimal) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('insert payload maps empty/optional fields to null and derives photo_url', async () => {
    await POST(makeRequest(validFull) as any);
    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted.facility_name).toBe(validFull.facility_name);
    expect(inserted.photo_url).toBe(validFull.photo_urls[0]);
    expect(inserted.photo_urls).toEqual(validFull.photo_urls);
    expect(inserted.has_parking).toBe(true);
    expect(inserted.features).toEqual(['駐車場あり', '個室あり']);
  });

  test('minimal payload defaults has_parking=false, features=[], photo_urls=[]', async () => {
    await POST(makeRequest(validMinimal) as any);
    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted.has_parking).toBe(false);
    expect(inserted.features).toEqual([]);
    expect(inserted.photo_urls).toEqual([]);
    expect(inserted.photo_url).toBeNull();
    expect(inserted.postal_code).toBeNull();
  });

  test('missing required facility_name → 400', async () => {
    const { facility_name, ...rest } = validFull;
    void facility_name;
    const res = await POST(makeRequest(rest) as any);
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('invalid email → 400', async () => {
    const res = await POST(makeRequest({ ...validFull, email: 'not-an-email' }) as any);
    expect(res.status).toBe(400);
  });

  test('invalid phone (letters) → 400', async () => {
    const res = await POST(makeRequest({ ...validFull, phone: '090-ABCD' }) as any);
    expect(res.status).toBe(400);
  });

  // 【2026年7月8日 恒久根治の回帰防止】従来このAPI固有の緩い正規表現(/^[\d-]+$/、先頭0任意)を
  // 独自定義しており、共通ヘルパー phoneField()（先頭0必須の phoneRegex）より検証が緩かった。
  // ハイフンのみ・先頭0なしの数字列がこのAPI経由でのみ通過し得た。共通ヘルパーへの統一で
  // これらが拒否されることを確認する。
  test('phone がハイフンのみ(先頭0なし) → 400（共通phoneFieldへの統一後の回帰防止）', async () => {
    const res = await POST(makeRequest({ ...validFull, phone: '----' }) as any);
    expect(res.status).toBe(400);
  });

  test('phone が先頭0なしの数字列 → 400（共通phoneFieldへの統一後の回帰防止）', async () => {
    const res = await POST(makeRequest({ ...validFull, phone: '9012345678' }) as any);
    expect(res.status).toBe(400);
  });

  test('facility_name/representative_name/contact_name がスペースのみ → 400', async () => {
    expect((await POST(makeRequest({ ...validFull, facility_name: '   ' }) as any)).status).toBe(400);
    expect((await POST(makeRequest({ ...validFull, representative_name: '   ' }) as any)).status).toBe(400);
    expect((await POST(makeRequest({ ...validFull, contact_name: '   ' }) as any)).status).toBe(400);
  });

  test('seat_count out of range → 400', async () => {
    const res = await POST(makeRequest({ ...validFull, seat_count: 100000 }) as any);
    expect(res.status).toBe(400);
  });

  test('features over 20 items → 400', async () => {
    const res = await POST(
      makeRequest({ ...validFull, features: Array.from({ length: 21 }, (_, i) => `f${i}`) }) as any
    );
    expect(res.status).toBe(400);
  });

  test('null body → 400', async () => {
    const req = new Request('http://localhost/api/salons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: 'not json',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  test('photo_url from foreign origin → 400', async () => {
    const res = await POST(
      makeRequest({ ...validFull, photo_url: 'https://evil.example.com/x.jpg', photo_urls: [] }) as any
    );
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('photo_urls containing foreign origin → 400', async () => {
    const res = await POST(
      makeRequest({ ...validFull, photo_url: null, photo_urls: [`${STORAGE_PREFIX}ok.jpg`, 'https://evil.example.com/x.jpg'] }) as any
    );
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('empty-string photo urls filtered out (not treated as foreign)', async () => {
    const res = await POST(
      makeRequest({ ...validFull, photo_url: null, photo_urls: ['', `${STORAGE_PREFIX}ok.jpg`] }) as any
    );
    expect(res.status).toBe(200);
    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted.photo_urls).toEqual([`${STORAGE_PREFIX}ok.jpg`]);
    expect(inserted.photo_url).toBe(`${STORAGE_PREFIX}ok.jpg`);
  });

  test('photo provided but NEXT_PUBLIC_SUPABASE_URL unset → 400 (defensive)', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await POST(
      makeRequest({ ...validFull, photo_url: 'https://x/y.jpg', photo_urls: [] }) as any
    );
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('DB insert error → 500', async () => {
    setupDefaultMocks({ insertError: true });
    const res = await POST(makeRequest(validFull) as any);
    expect(res.status).toBe(500);
  });

  test('insert returns no data → 500', async () => {
    setupDefaultMocks({ noData: true });
    const res = await POST(makeRequest(validFull) as any);
    expect(res.status).toBe(500);
  });

  test('exception (createClient throws) → 500', async () => {
    const { createClient } = require('@supabase/supabase-js');
    createClient.mockImplementation(() => { throw new Error('boom'); });
    const res = await POST(makeRequest(validFull) as any);
    expect(res.status).toBe(500);
  });
});
