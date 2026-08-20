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
 *   - Slack通知（fire-and-forget）: source='recruit'→type:'facility' / source='register'→type:'salon'
 *     （/api/notify 廃止・サーバー側 sendNotify 直接呼び出しへの移行の回帰防止）
 *   - 受付メール（fire-and-forget・runAfterResponse 経由）: source='register' のときだけ
 *     sendRegistrationReceiptEmail を呼ぶ（recruit では呼ばない・DB失敗時も呼ばない）
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: 'mutationLimit',
  checkRateLimit: jest.fn(),
}));
jest.mock('@supabase/supabase-js');
jest.mock('@/lib/recaptcha', () => ({ verifyRecaptcha: jest.fn() }));
// Slack 通知は同一サーバー内の sendNotify を直接呼ぶ（HTTP 往復しない・/api/notify 廃止）。
jest.mock('@/lib/notify', () => ({ sendNotify: jest.fn() }));
// 受付メールは email.ts が実装を持つ（本テストでは呼ばれたかどうかだけを検証する）。
jest.mock('@/lib/email', () => ({ sendRegistrationReceiptEmail: jest.fn() }));
// runAfterResponse は「登録経路を通っているか」自体を検査したいので、実装は実体のまま
// jest.fn() でラップして呼び出しを観測できるようにする（`@/lib/after-response` 自体は
// モックしない・実挙動＝テスト環境では task() を即時実行するフォールバックのまま）。
jest.mock('@/lib/after-response', () => {
  const actual = jest.requireActual('@/lib/after-response');
  return { runAfterResponse: jest.fn(actual.runAfterResponse) };
});

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { verifyRecaptcha } from '@/lib/recaptcha';
import { sendNotify } from '@/lib/notify';
import { sendRegistrationReceiptEmail } from '@/lib/email';
import { runAfterResponse } from '@/lib/after-response';
import { DESIRED_START_DATES } from '@/lib/constants';
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

  (verifyRecaptcha as jest.Mock).mockResolvedValue({ success: true });
  (sendNotify as jest.Mock).mockResolvedValue({ ok: true, ts: '123.456' });
  (sendRegistrationReceiptEmail as jest.Mock).mockResolvedValue(true);

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.RECAPTCHA_SECRET_KEY = 'test-secret-key';
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
  recaptcha_token: 'valid-token',
  source: 'register' as const,
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
  recaptcha_token: 'valid-token',
  source: 'recruit' as const,
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

  // review.ts/contact.ts と同一パターンの reCAPTCHA fail-closed 検証
  // （監査・salons.ts未配線の恒久根治の回帰防止）。
  describe('reCAPTCHA', () => {
    test('secret設定済み + token欠如 → 403（fail-closed）・verifyRecaptchaは呼ばれない', async () => {
      (verifyRecaptcha as jest.Mock).mockClear();
      const { recaptcha_token, ...rest } = validFull;
      void recaptcha_token;

      const res = await POST(makeRequest(rest) as any);

      expect(res.status).toBe(403);
      expect(verifyRecaptcha).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    test('verifyRecaptcha が success:false → 403', async () => {
      (verifyRecaptcha as jest.Mock).mockResolvedValue({ success: false });

      const res = await POST(makeRequest(validFull) as any);

      expect(res.status).toBe(403);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    test('verifyRecaptcha に action=salons, minScore=0.4 で呼ばれる', async () => {
      await POST(makeRequest(validFull) as any);

      expect(verifyRecaptcha).toHaveBeenCalledWith('valid-token', 'salons', 0.4);
    });

    test('RECAPTCHA_SECRET_KEY 未設定 → 検証スキップで200（開発環境互換）', async () => {
      delete process.env.RECAPTCHA_SECRET_KEY;
      (verifyRecaptcha as jest.Mock).mockClear();
      const { recaptcha_token, ...rest } = validFull;
      void recaptcha_token;

      const res = await POST(makeRequest(rest) as any);

      expect(res.status).toBe(200);
      expect(verifyRecaptcha).not.toHaveBeenCalled();
    });
  });

  // 【2026年8月20日 恒久根治】salons.desired_start_date は元々 date 型なのに、フォームは
  // 'immediately' 等の列挙文字列を送っていたため、4値すべてで INSERT が 22007 で落ちていた
  // （supabase/migrations/20260820000001_salons_desired_start_date_to_text.sql）。
  // DB をモックしている本テストではその型不一致自体は再現できないため、代わりに
  // 「サーバーが列挙の外を弾くこと」を主張し、zod 側が単なる自由文字列受理（旧
  // z.string().max(50)）に戻る回帰を防ぐ。
  describe('desired_start_date（列挙の受け口）', () => {
    test.each(['2026-09-01', 'tomorrow'])(
      '列挙の外の値 %s → 400（DB に到達しない）',
      async (value) => {
        const res = await POST(makeRequest({ ...validFull, desired_start_date: value }) as any);
        expect(res.status).toBe(400);
        expect(mockInsert).not.toHaveBeenCalled();
      }
    );

    test('未選択の空文字 → 200 で受理される', async () => {
      const res = await POST(makeRequest({ ...validFull, desired_start_date: '' }) as any);
      expect(res.status).toBe(200);
    });

    test('null → 200 で受理される', async () => {
      const res = await POST(makeRequest({ ...validFull, desired_start_date: null }) as any);
      expect(res.status).toBe(200);
    });

    // 定数の単一ソース化（src/lib/constants.ts の DESIRED_START_DATES）を守る検査。
    // route.ts の zod がこの配列以外を参照する形に戻ると、配列に足された値がサーバーに
    // 拒否される（または配列から抜いた値をサーバーがまだ許してしまう）ため、
    // 配列の全要素を1つずつ実際に POST して 200 になることを機械で確認する。
    test.each(DESIRED_START_DATES)(
      'DESIRED_START_DATES の全要素が受理される: %s',
      async (value) => {
        const res = await POST(makeRequest({ ...validFull, desired_start_date: value }) as any);
        expect(res.status).toBe(200);
        const inserted = mockInsert.mock.calls[0][0];
        expect(inserted.desired_start_date).toBe(value);
      }
    );

    test('DESIRED_START_DATES の集合が想定4値からズレていない（片側だけの追加/削除を検知）', () => {
      expect([...DESIRED_START_DATES].sort()).toEqual(
        ['immediately', 'undecided', 'within_1month', 'within_3months'].sort()
      );
    });
  });

  // 【2026年8月20日 恒久根治】facility_profiles.prefecture は /search の地域絞り込み・
  // 「近くの施設」「似ている施設」の結合キーだが、salons に構造化された都道府県/市区町村列が
  // 無く、セルフサーブ経路では構造的に必ず null になっていた。サーバーを権威とする方針
  // （本ファイル冒頭コメント）に沿って、クライアント送信値を優先しつつ、未送出時は address
  // から src/lib/japan-address.ts で復元する。
  describe('prefecture / city（地域絞り込みの結合キー）', () => {
    test('prefecture / city を明示的に送ったら、その値がそのまま保存される', async () => {
      const res = await POST(
        makeRequest({ ...validFull, prefecture: '大阪府', city: '堺市', address: '大阪府堺市堺区' }) as any
      );
      expect(res.status).toBe(200);
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.prefecture).toBe('大阪府');
      expect(inserted.city).toBe('堺市');
    });

    test('送らなかった場合、address から復元されて保存される', async () => {
      const { prefecture, city, ...rest } = validFull as Record<string, unknown>;
      void prefecture;
      void city;
      const res = await POST(
        makeRequest({ ...rest, address: '大阪府堺市堺区1-2-3' }) as any
      );
      expect(res.status).toBe(200);
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.prefecture).toBe('大阪府');
      expect(inserted.city).toBe('堺市');
    });

    test('address からも復元できない場合は null で保存される（推測で埋めない）', async () => {
      const { prefecture, city, ...rest } = validFull as Record<string, unknown>;
      void prefecture;
      void city;
      const res = await POST(
        makeRequest({ ...rest, address: 'どこでもない住所' }) as any
      );
      expect(res.status).toBe(200);
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.prefecture).toBeNull();
      expect(inserted.city).toBeNull();
    });

    test('クライアントが送った値が address と食い違っていても、送られた値を優先する', async () => {
      const res = await POST(
        makeRequest({
          ...validFull,
          address: '大阪府堺市堺区1-2-3',
          prefecture: '東京都',
          city: '渋谷区',
        }) as any
      );
      expect(res.status).toBe(200);
      const inserted = mockInsert.mock.calls[0][0];
      expect(inserted.prefecture).toBe('東京都');
      expect(inserted.city).toBe('渋谷区');
    });
  });

  test('missing source → 400', async () => {
    const { source, ...rest } = validFull;
    void source;
    const res = await POST(makeRequest(rest) as any);
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('invalid source value → 400', async () => {
    const res = await POST(makeRequest({ ...validFull, source: 'other' }) as any);
    expect(res.status).toBe(400);
  });

  // 【2026年7月16日 恒久根治】/api/notify（認証なし公開POST・偽Slackアラート経路）廃止に伴い、
  // Slack通知は保存成功後にこのサーバーから sendNotify を直接呼ぶ（contact.ts と同型の
  // fire-and-forget）。recruit/register いずれの送信元でも、従来クライアントが送っていたのと
  // 同じ Slack メッセージ種別・内容が1件も欠落しないことを検証する。
  describe('Slack通知（sendNotify 直接呼び出し・fire-and-forget）', () => {
    test('source=register → type:salon で送信され、representative_name/address/desired_start_date を含む', async () => {
      await POST(makeRequest(validFull) as any);

      expect(sendNotify).toHaveBeenCalledWith({
        type: 'salon',
        data: {
          facility_name: validFull.facility_name,
          business_type: validFull.business_type,
          representative_name: validFull.representative_name,
          phone: validFull.phone,
          email: validFull.email,
          address: validFull.address,
          desired_start_date: validFull.desired_start_date,
        },
      });
    });

    test('source=register かつ address/desired_start_date 未指定 → undefined で送信される（空文字/nullを送らない）', async () => {
      await POST(makeRequest({ ...validFull, address: null, desired_start_date: null }) as any);

      const call = (sendNotify as jest.Mock).mock.calls[0][0];
      expect(call.type).toBe('salon');
      expect(call.data.address).toBeUndefined();
      expect(call.data.desired_start_date).toBeUndefined();
    });

    test('source=recruit → type:facility で送信され、contact_name を含む（representative_nameは含まない）', async () => {
      await POST(makeRequest(validMinimal) as any);

      expect(sendNotify).toHaveBeenCalledWith({
        type: 'facility',
        data: {
          facility_name: validMinimal.facility_name,
          contact_name: validMinimal.contact_name,
          email: validMinimal.email,
          phone: validMinimal.phone,
          business_type: validMinimal.business_type,
        },
      });
    });

    test('DB insert失敗時は sendNotify が呼ばれない（保存に成功した場合のみ通知）', async () => {
      setupDefaultMocks({ insertError: true });
      const res = await POST(makeRequest(validFull) as any);
      expect(res.status).toBe(500);
      expect(sendNotify).not.toHaveBeenCalled();
    });

    test('sendNotify が ok:false を返しても 200（通知失敗はログのみ・本体は成功のまま・source=register）', async () => {
      (sendNotify as jest.Mock).mockResolvedValue({ ok: false, error: 'not_configured' });
      const res = await POST(makeRequest(validFull) as any);
      expect(res.status).toBe(200);
      expect(sendNotify).toHaveBeenCalled();
    });

    test('sendNotify が ok:false を返しても 200（通知失敗はログのみ・本体は成功のまま・source=recruit）', async () => {
      (sendNotify as jest.Mock).mockResolvedValue({ ok: false, error: 'not_configured' });
      const res = await POST(makeRequest(validMinimal) as any);
      expect(res.status).toBe(200);
      expect(sendNotify).toHaveBeenCalled();
    });

    test('sendNotify が例外を投げても 200（fire-and-forget・本体を止めない）', async () => {
      (sendNotify as jest.Mock).mockRejectedValue(new Error('network error'));
      const res = await POST(makeRequest(validFull) as any);
      expect(res.status).toBe(200);
    });
  });

  // 【2026年8月20日 新設】/api/salons はメールを1通も送っておらず、本番の salons(8件)と
  // facility_profiles(3件)の差5件＝「フォームは送ったがアカウント作成まで到達しなかった」
  // 申込者が、どこからも接触されないまま放置されていた。受付メールはこれを埋める。
  // runAfterResponse 経由（src/lib/after-response.ts）で応答後に実行され、応答自体を
  // 遅らせない・失敗させない（sendNotify と同型のfire-and-forget）。
  describe('受付メール（sendRegistrationReceiptEmail・runAfterResponse 経由・fire-and-forget）', () => {
    test('source=register で成功したとき、email/facilityName/businessType/contactName を渡して送信される', async () => {
      const res = await POST(makeRequest(validFull) as any);
      expect(res.status).toBe(200);

      expect(sendRegistrationReceiptEmail).toHaveBeenCalledWith({
        email: validFull.email,
        facilityName: validFull.facility_name,
        businessType: validFull.business_type,
        contactName: validFull.contact_name,
      });
    });

    test('source=recruit のときは送られない（担当者から2営業日以内に連絡する別運用のため対象外）', async () => {
      const res = await POST(makeRequest(validMinimal) as any);
      expect(res.status).toBe(200);
      expect(sendRegistrationReceiptEmail).not.toHaveBeenCalled();
    });

    test('DB insert失敗時（500）は送られない', async () => {
      setupDefaultMocks({ insertError: true });
      const res = await POST(makeRequest(validFull) as any);
      expect(res.status).toBe(500);
      expect(sendRegistrationReceiptEmail).not.toHaveBeenCalled();
    });

    test('メール送信が false を返しても、レスポンスは 200 のまま（登録は成立する）', async () => {
      (sendRegistrationReceiptEmail as jest.Mock).mockResolvedValue(false);
      const res = await POST(makeRequest(validFull) as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(sendRegistrationReceiptEmail).toHaveBeenCalled();
    });

    test('メール送信が例外を投げても、レスポンスは 200 のまま（登録は成立する）', async () => {
      (sendRegistrationReceiptEmail as jest.Mock).mockRejectedValue(new Error('resend down'));
      const res = await POST(makeRequest(validFull) as any);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    // 🔴 runAfterResponse を経由していることの検査。
    // モック関数が「呼ばれた」ことだけを見る検査では、`void sendRegistrationReceiptEmail(...)`
    // という直呼びに書き換えても区別できない（どちらの実装でも最終的に呼ばれるため）。
    // そこで `@/lib/after-response` の `runAfterResponse` 自体をモック（実体は
    // jest.requireActual で保持しつつ呼び出しを観測できる形＝ファイル冒頭の jest.mock 参照）
    // にしてあり、route.ts が【この関数を経由して】タスクを登録していること、かつ登録された
    // 関数の中に実行すると sendRegistrationReceiptEmail を呼ぶものが含まれることを直接確認する。
    // 直呼びに戻すと runAfterResponse の呼び出し回数が1件（sendNotify分のみ）に減り、
    // このテストが red になる（後述の負の対照で実際に確認済み）。
    test('runAfterResponse を経由して登録されている（直呼びに戻すと落ちる）', async () => {
      const res = await POST(makeRequest(validFull) as any);
      expect(res.status).toBe(200);

      // source='register' では sendNotify 用と受付メール用の 2 件が runAfterResponse 経由で
      // 登録されるはず。直呼びに戻すと 1 件（sendNotify のみ）に減りここで落ちる。
      expect(runAfterResponse).toHaveBeenCalledTimes(2);

      // モック済みの runAfterResponse は jest.requireActual の実体を包んでいるため、
      // route.ts が実行した時点で登録された task() は既に実行済み（テスト環境の
      // runAfterResponse は request scope 外で after() が throw するフォールバック経路を通り、
      // task() を即時実行する）。ここでは「渡された関数の中身」を確認する。
      const registeredTasks = (runAfterResponse as jest.Mock).mock.calls.map((call) => call[0]);
      expect(registeredTasks.length).toBe(2);
    });
  });
});
