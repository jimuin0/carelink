/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for src/lib/notify.ts
 * Key assertions:
 *   - sendNotify: SLACK_BOT_TOKEN/SLACK_DEFAULT_CHANNEL 未設定時は ok=false を返す
 *   - sendNotify: 不正な payload は ok=false を返す
 *   - adminUrlFor: NEXT_PUBLIC_BASE_URL 未設定時はデフォルト URL (https://carelink-jp.com) を使う
 *   - 各 type (contact/facility_inquiry) の Slack メッセージ組み立て
 *   - 🔴 Slack に個人情報（氏名・メール・電話・本文）を載せない（2026年10月22日）
 *   - postToSlack 失敗時は ok=false を返す
 */

const mockPostToSlack = jest.fn();

jest.mock('@/lib/slack', () => ({
  postToSlack: (...args: unknown[]) => mockPostToSlack(...args),
  sectionBlock: (text: string) => ({
    type: 'section',
    text: { type: 'mrkdwn', text },
  }),
  actionsBlock: (elements: unknown[]) => ({
    type: 'actions',
    elements,
  }),
  linkButtonElement: (text: string, url: string) => ({
    type: 'button',
    text: { type: 'plain_text', text },
    url,
  }),
  contextBlock: (elements: string[]) => ({
    type: 'context',
    elements: elements.map((e) => ({
      type: 'mrkdwn',
      text: e,
    })),
  }),
}));

import { sendNotify, type NotifyPayload } from '../notify';

const CONTACT_ID = '71000000-0000-4000-8000-0000000000c1';
const INQUIRY_ID = '71000000-0000-4000-8000-0000000000a1';

const contactPayload: NotifyPayload = {
  type: 'contact',
  data: { contact_id: CONTACT_ID },
};

test('返信受理通知には受付番号のみを載せ、氏名や本文を落とす', async () => {
  const input = untyped({ type: 'contact_reply_sent', data: { contact_id: CONTACT_ID, name: '秘密の名前', body: '秘密の本文' } });
  expect((await sendNotify(input)).ok).toBe(true);
  expect(postedToSlack()).toContain('返信を送信サービスが受理');
  expect(postedToSlack()).toContain(CONTACT_ID);
  expect(postedToSlack()).toContain(`/admin/mail?contactId=${CONTACT_ID}`);
  expect(postedToSlack()).not.toContain('秘密の名前');
  expect(postedToSlack()).not.toContain('秘密の本文');
});

const facilityInquiryData = { inquiry_id: INQUIRY_ID, facility_name: 'テスト施設' };

const facilityInquiryPayload: NotifyPayload = {
  type: 'facility_inquiry',
  data: facilityInquiryData,
};

/** 型を通らない入力（実行時の検証を確かめる）。 */
const untyped = (value: unknown) => value as NotifyPayload;

/** Slack へ渡した全内容（本文・ブロック）を 1 つの文字列にする */
function postedToSlack(): string {
  return JSON.stringify(mockPostToSlack.mock.calls);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPostToSlack.mockResolvedValue({
    ok: true,
    ts: '1234.5678',
  });
  process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
  process.env.SLACK_DEFAULT_CHANNEL = 'C0TESTCHAN';
  process.env.NEXT_PUBLIC_BASE_URL = 'https://carelink-jp.com';
});

describe('sendNotify — SLACK設定チェック', () => {
  test('SLACK_BOT_TOKEN 未設定 → ok=false / error=not_configured', async () => {
    delete process.env.SLACK_BOT_TOKEN;

    const result = await sendNotify(contactPayload);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_configured');
    expect(mockPostToSlack).not.toHaveBeenCalled();
  });

  test('SLACK_DEFAULT_CHANNEL 未設定 → ok=false / error=not_configured', async () => {
    delete process.env.SLACK_DEFAULT_CHANNEL;

    const result = await sendNotify(contactPayload);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_configured');
  });
});

describe('sendNotify — ペイロードバリデーション', () => {
  test('type なしペイロード → ok=false / error=invalid_payload', async () => {
    const result = await sendNotify(untyped({ data: {} }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_payload');
  });

  test.each(['unknown', 'salon', 'facility'])('受け付けない type（%s。個人情報だけを載せていた旧種別を含む）→ invalid_payload', async (type) => {
    const result = await sendNotify(untyped({ type, data: { facility_name: 'X', email: 'x@example.invalid' } }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_payload');
    expect(mockPostToSlack).not.toHaveBeenCalled();
  });

  test.each([
    ['contact', { contact_id: 'not-a-uuid' }],
    ['contact', {}],
    ['facility_inquiry', { inquiry_id: 'x', facility_name: 'X' }],
    ['facility_inquiry', { inquiry_id: INQUIRY_ID }],
  ])('%s の受付番号・施設名が無い／不正 → invalid_payload（Slack に任意の文字列を入れない）', async (type, data) => {
    const result = await sendNotify(untyped({ type, data }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_payload');
  });
});

describe('sendNotify — type ごとの Slack メッセージ送信', () => {
  test('contact type → 受付番号を載せて送信し ok=true / ts を返す', async () => {
    const result = await sendNotify(contactPayload);

    expect(result.ok).toBe(true);
    expect(result.ts).toBe('1234.5678');
    expect(mockPostToSlack).toHaveBeenCalledTimes(1);

    const [args] = mockPostToSlack.mock.calls;

    expect(args[0].text).toContain('お問い合わせ（運営宛）を受け付けました');
    expect(args[0].text).toContain(CONTACT_ID);
    expect(args[0].text).toContain('内容は管理画面で確認してください');
  });

  test('facility_inquiry type → 施設名と受付番号を載せて送信し ok=true', async () => {
    const result = await sendNotify(facilityInquiryPayload);

    expect(result.ok).toBe(true);

    const [args] = mockPostToSlack.mock.calls;

    expect(args[0].text).toContain('施設へのお問い合わせを受け付けました');
    expect(args[0].text).toContain('テスト施設');
    expect(args[0].text).toContain(INQUIRY_ID);
  });
});

// 🔴 回帰: 以前は来院者のお名前・メール・電話・本文（症状が書かれやすい）を全文そのまま Slack へ
// 転記していた。Slack はプライバシーポリシー第5条の委託先に無い。型から欄を消したうえで、
// 型をすり抜けて渡されても（旧呼び出し側と同じ形）Slack には一切届かないことを確かめる。
describe('sendNotify — Slack に個人情報を載せない', () => {
  const pii = {
    name: '山田花子',
    email: 'hanako.yamada@example.invalid',
    phone: '090-1234-5678',
    message: '先週から腰痛がひどく、相談したいです',
    inquiry_type: '個人的なご相談',
    traffic_source: { source: 'threads', medium: 'social', referrerHost: 'www.threads.net', landingPath: '/lp/secret', capturedAt: '2026-10-22T00:00:00.000Z' },
  };

  test.each([
    ['facility_inquiry', { inquiry_id: INQUIRY_ID, facility_id: '71000000-0000-4000-8000-000000000002', facility_name: 'テスト施設', ...pii }],
    ['contact', { contact_id: CONTACT_ID, ...pii }],
  ])('%s: 入力した氏名・メール・電話・本文が Slack の本文にもブロックにも含まれない', async (type, data) => {
    const result = await sendNotify(untyped({ type, data }));

    expect(result.ok).toBe(true);
    const posted = postedToSlack();
    for (const value of [pii.name, pii.email, pii.phone, pii.message, '腰痛', 'hanako', '1234-5678', pii.inquiry_type, pii.traffic_source.landingPath, pii.traffic_source.referrerHost]) {
      expect(posted).not.toContain(value);
    }
    expect(posted).not.toMatch(/お名前|メール:|電話:|内容:|流入元/);
  });
});

describe('sendNotify — XSS エスケープ', () => {
  test('facility_name に HTML 特殊文字が含まれる場合エスケープされる', async () => {
    await sendNotify({
      type: 'facility_inquiry',
      data: { inquiry_id: INQUIRY_ID, facility_name: '<script>alert(1)</script>&' },
    });

    const [args] = mockPostToSlack.mock.calls;

    expect(args[0].text).not.toContain('<script>');
    expect(args[0].text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&amp;');
  });
});

describe('sendNotify — adminUrlFor のデフォルト URL フォールバック', () => {
  test('NEXT_PUBLIC_BASE_URL 未設定 → デフォルト URL https://carelink-jp.com を使う', async () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;

    const result = await sendNotify(contactPayload);

    expect(result.ok).toBe(true);
    expect(mockPostToSlack).toHaveBeenCalledTimes(1);

    // blocks を JSON 文字列化して url の存在を確認（ネスト構造に依存しない）
    const callArg = mockPostToSlack.mock.calls[0][0];
    const blocksJson = JSON.stringify(callArg.blocks);

    expect(blocksJson).toContain('https://carelink-jp.com');
  });
});

describe('sendNotify — Slack 送信失敗', () => {
  test('postToSlack が ok=false を返した場合 → ok=false / error を伝播する', async () => {
    mockPostToSlack.mockResolvedValue({
      ok: false,
      error: 'slack_api_error',
    });

    const result = await sendNotify(contactPayload);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('slack_api_error');
  });
});

describe('adminUrlFor — type ごとの管理画面 URL', () => {
  // blocks を JSON 文字列化してパス存在確認（ネスト構造に依存しない）
  function getBlocksJson(): string {
    return JSON.stringify(mockPostToSlack.mock.calls[0][0].blocks);
  }

  test('contact type → /admin/inquiries（NEXT_PUBLIC_BASE_URL 設定あり）', async () => {
    await sendNotify(contactPayload);

    expect(getBlocksJson()).toContain('https://carelink-jp.com/admin/inquiries');
  });

  // 【2026年7月10日 恒久根治】/admin/inquiries は facility_inquiries を一切表示しない別テーブル
  // (contacts) のページ。正しいリンク先 /admin/facility-inquiries に固定する回帰テスト。
  test('facility_inquiry type → /admin/facility-inquiries（/admin/inquiries ではない）', async () => {
    await sendNotify(facilityInquiryPayload);

    const blocks = getBlocksJson();

    expect(blocks).toContain('/admin/facility-inquiries');
    expect(blocks).not.toContain('/admin/inquiries"'); // 末尾"で完全一致を除外（facility-inquiriesの部分一致を誤検知しないため）
  });

  // 2026年10月22日：複数店舗のメンバーが別の店舗の問い合わせ画面を開かないよう、店舗を URL で指定する。
  test('facility_inquiry に facility_id があれば管理画面リンクに ?facility_id= を付ける', async () => {
    const facilityId = '71000000-0000-4000-8000-000000000002';
    await sendNotify({ type: 'facility_inquiry', data: { ...facilityInquiryData, facility_id: facilityId } });
    expect(getBlocksJson()).toContain(`/admin/facility-inquiries?facility_id=${facilityId}`);
  });

  // リンクの付加情報が不正なだけで、問い合わせの通知そのものを落とさない（回帰防止）。
  test('facility_id が UUID でなければ値だけ捨て、店舗指定なしのリンクで通知は送る（URL へ任意文字列を入れない）', async () => {
    const result = await sendNotify({ type: 'facility_inquiry', data: { ...facilityInquiryData, facility_id: 'x&y=1' } });
    expect(result.ok).toBe(true);
    expect(mockPostToSlack).toHaveBeenCalledTimes(1);
    const blocks = getBlocksJson();
    expect(blocks).toContain('/admin/facility-inquiries"');
    expect(blocks).not.toContain('facility_id=');
    expect(blocks).not.toContain('x&y=1');
  });

  // zod 4 の z.string().uuid() は RFC のバージョン桁まで見るため、手で入れた id のような
  // 形（Postgres は受け付ける）を弾き、通知全体を invalid_payload で失っていた。
  test('バージョン桁が RFC 形式でない UUID でも通知を送り、リンクに店舗を付ける', async () => {
    const facilityId = '00000000-0000-0000-0000-000000000001';
    const result = await sendNotify({ type: 'facility_inquiry', data: { ...facilityInquiryData, facility_id: facilityId } });
    expect(result.ok).toBe(true);
    expect(getBlocksJson()).toContain(`/admin/facility-inquiries?facility_id=${facilityId}`);
  });
});
