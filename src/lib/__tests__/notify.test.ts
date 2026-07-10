/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for src/lib/notify.ts
 * Key assertions:
 *   - sendNotify: SLACK_BOT_TOKEN/SLACK_DEFAULT_CHANNEL 未設定時は ok=false を返す
 *   - sendNotify: 不正な payload は ok=false を返す
 *   - adminUrlFor: NEXT_PUBLIC_BASE_URL 未設定時はデフォルト URL (https://carelink-jp.com) を使う（行22フォールバック）
 *   - 各 type (salon/contact/facility_inquiry/facility) の Slack メッセージ組み立て
 *   - postToSlack 失敗時は ok=false を返す
 */

const mockPostToSlack = jest.fn();

jest.mock('@/lib/slack', () => ({
  postToSlack: (...args: unknown[]) => mockPostToSlack(...args),
  sectionBlock: (text: string) => ({ type: 'section', text: { type: 'mrkdwn', text } }),
  actionsBlock: (elements: unknown[]) => ({ type: 'actions', elements }),
  linkButtonElement: (text: string, url: string) => ({ type: 'button', text: { type: 'plain_text', text }, url }),
  contextBlock: (elements: string[]) => ({ type: 'context', elements: elements.map(e => ({ type: 'mrkdwn', text: e })) }),
}));

import { sendNotify } from '../notify';

const salonPayload = {
  type: 'salon' as const,
  data: {
    facility_name: 'テストサロン',
    business_type: '美容',
    representative_name: '山田太郎',
    phone: '0312345678',
    email: 'test@example.com',
  },
};

const contactPayload = {
  type: 'contact' as const,
  data: {
    name: 'テストユーザー',
    inquiry_type: '一般',
    email: 'contact@example.com',
    message: 'お問い合わせ内容',
  },
};

const facilityInquiryPayload = {
  type: 'facility_inquiry' as const,
  data: {
    facility_name: 'テスト施設',
    name: '問い合わせ者',
    email: 'inquiry@example.com',
    phone: '0312345678',
    message: 'お問い合わせです',
  },
};

const facilityPayload = {
  type: 'facility' as const,
  data: {
    facility_name: 'テスト施設',
    contact_name: '担当者',
    email: 'facility@example.com',
    phone: '0312345678',
    business_type: '医療',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPostToSlack.mockResolvedValue({ ok: true, ts: '1234.5678' });
  process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
  process.env.SLACK_DEFAULT_CHANNEL = 'C0TESTCHAN';
  process.env.NEXT_PUBLIC_BASE_URL = 'https://carelink-jp.com';
});

describe('sendNotify — SLACK設定チェック', () => {
  test('SLACK_BOT_TOKEN 未設定 → ok=false / error=not_configured', async () => {
    delete process.env.SLACK_BOT_TOKEN;
    const result = await sendNotify(salonPayload);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_configured');
    expect(mockPostToSlack).not.toHaveBeenCalled();
  });

  test('SLACK_DEFAULT_CHANNEL 未設定 → ok=false / error=not_configured', async () => {
    delete process.env.SLACK_DEFAULT_CHANNEL;
    const result = await sendNotify(salonPayload);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_configured');
  });
});

describe('sendNotify — ペイロードバリデーション', () => {
  test('type なしペイロード → ok=false / error=invalid_payload', async () => {
    const result = await sendNotify({ data: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_payload');
  });

  test('不正な type → ok=false / error=invalid_payload', async () => {
    const result = await sendNotify({ type: 'unknown', data: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_payload');
  });

  test('salon type: 必須フィールド不足 → ok=false / error=invalid_payload', async () => {
    const result = await sendNotify({ type: 'salon', data: { facility_name: 'X' } });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_payload');
  });
});

describe('sendNotify — type ごとの Slack メッセージ送信', () => {
  test('salon type → Slack に送信して ok=true / ts を返す', async () => {
    const result = await sendNotify(salonPayload);
    expect(result.ok).toBe(true);
    expect(result.ts).toBe('1234.5678');
    expect(mockPostToSlack).toHaveBeenCalledTimes(1);
    const [args] = mockPostToSlack.mock.calls;
    expect(args[0].text).toContain('施設掲載の新規登録');
    expect(args[0].text).toContain('テストサロン');
  });

  test('salon type: address/desired_start_date オプションフィールドあり → 本文に含まれる', async () => {
    const result = await sendNotify({
      type: 'salon',
      data: { ...salonPayload.data, address: '東京都渋谷区', desired_start_date: '2026-08-01' },
    });
    expect(result.ok).toBe(true);
    const [args] = mockPostToSlack.mock.calls;
    expect(args[0].text).toContain('東京都渋谷区');
    expect(args[0].text).toContain('2026-08-01');
  });

  test('contact type → Slack に送信して ok=true', async () => {
    const result = await sendNotify(contactPayload);
    expect(result.ok).toBe(true);
    const [args] = mockPostToSlack.mock.calls;
    expect(args[0].text).toContain('お問い合わせ');
    expect(args[0].text).toContain('テストユーザー');
  });

  test('facility_inquiry type → Slack に送信して ok=true', async () => {
    const result = await sendNotify(facilityInquiryPayload);
    expect(result.ok).toBe(true);
    const [args] = mockPostToSlack.mock.calls;
    expect(args[0].text).toContain('施設へのお問い合わせ');
    expect(args[0].text).toContain('テスト施設');
  });

  test('facility type → Slack に送信して ok=true', async () => {
    const result = await sendNotify(facilityPayload);
    expect(result.ok).toBe(true);
    const [args] = mockPostToSlack.mock.calls;
    expect(args[0].text).toContain('施設掲載の申し込み');
    expect(args[0].text).toContain('テスト施設');
  });
});

describe('sendNotify — XSS エスケープ', () => {
  test('facility_name に HTML 特殊文字が含まれる場合エスケープされる', async () => {
    await sendNotify({
      type: 'salon',
      data: { ...salonPayload.data, facility_name: '<script>alert(1)</script>' },
    });
    const [args] = mockPostToSlack.mock.calls;
    expect(args[0].text).not.toContain('<script>');
    expect(args[0].text).toContain('&lt;script&gt;');
  });
});

describe('sendNotify — adminUrlFor のデフォルト URL フォールバック（行22）', () => {
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
    mockPostToSlack.mockResolvedValue({ ok: false, error: 'slack_api_error' });
    const result = await sendNotify(salonPayload);
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
    expect(getBlocksJson()).toContain('/admin/inquiries');
  });

  test('salon type → /admin/registrations', async () => {
    await sendNotify(salonPayload);
    expect(getBlocksJson()).toContain('/admin/registrations');
  });

  test('facility type → /admin/registrations', async () => {
    await sendNotify(facilityPayload);
    expect(getBlocksJson()).toContain('/admin/registrations');
  });

  // 【2026年7月10日 恒久根治】/admin/inquiries は facility_inquiries を一切表示しない別テーブル
  // (contacts) のページ。正しいリンク先 /admin/facility-inquiries に固定する回帰テスト。
  test('facility_inquiry type → /admin/facility-inquiries（/admin/inquiries ではない）', async () => {
    await sendNotify(facilityInquiryPayload);
    const blocks = getBlocksJson();
    expect(blocks).toContain('/admin/facility-inquiries');
    expect(blocks).not.toContain('/admin/inquiries"'); // 末尾"で完全一致を除外（facility-inquiriesの部分一致を誤検知しないため）
  });
});
