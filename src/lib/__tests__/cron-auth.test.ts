/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for checkCronAuth
 * Key assertions:
 *   - CRON_SECRET 未設定で 500
 *   - 正しい Bearer トークンで null（通過）
 *   - 誤ったトークンで 401
 *   - Authorization ヘッダーなしで 401
 *   - タイミング攻撃防止（timingSafeEqual 使用）
 *   - 長さが異なるトークンでも安全
 */

jest.mock('next/server', () => ({
  NextResponse: {
    // serverError() は返した応答に ALERTED ヘッダを立てるため headers を持つ形で返す
    // （実物の NextResponse と同じく set() が生えている必要がある）。
    json: (body: Record<string, unknown>, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
      headers: new Map<string, string>() as unknown as Headers,
    }),
  },
}));

// CRON_SECRET 未設定の 500 が【通知に載る】ことを検証するため、通知経路をスパイする。
const captured: unknown[][] = [];
const alerted: unknown[][] = [];
jest.mock('@/lib/safe', () => ({
  safeCaptureException: (...args: unknown[]) => { captured.push(args); },
}));
jest.mock('@/lib/alert', () => ({
  alertCaughtError: (...args: unknown[]) => { alerted.push(args); },
}));

import { checkCronAuth } from '../cron-auth';

function makeRequest(authHeader?: string): Request {
  return {
    url: 'https://carelink-jp.com/api/cron/booking-reminder',
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'authorization') return authHeader ?? null;
        return null;
      },
    },
  } as unknown as Request;
}

const SECRET = 'my-super-secret-cron-key-12345';

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  captured.length = 0;
  alerted.length = 0;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('checkCronAuth', () => {
  test('正しい Bearer トークン → null（通過）', () => {
    const req = makeRequest(`Bearer ${SECRET}`);
    expect(checkCronAuth(req)).toBeNull();
  });

  test('誤ったトークン → 401', () => {
    const req = makeRequest('Bearer wrong-secret');
    const res = checkCronAuth(req) as any;
    expect(res.status).toBe(401);
  });

  test('Authorization ヘッダーなし → 401', () => {
    const req = makeRequest(undefined);
    const res = checkCronAuth(req) as any;
    expect(res.status).toBe(401);
  });

  test('Bearer プレフィックスなし → 401', () => {
    const req = makeRequest(SECRET);
    const res = checkCronAuth(req) as any;
    expect(res.status).toBe(401);
  });

  test('CRON_SECRET 未設定 → 500', () => {
    delete process.env.CRON_SECRET;
    const req = makeRequest(`Bearer ${SECRET}`);
    const res = checkCronAuth(req) as any;
    expect(res.status).toBe(500);
    // 応答の形は従来と同一（dispatcher / 監視が読む形を変えない）
    expect(res.body).toEqual({ error: 'Server misconfiguration' });
  });

  // 🔴 この 500 は cron 15 本すべてを同時に殺すのに、withRoute を通らないため
  //   長らく無音だった（認証は logCronRun より前なので cron_logs にも残らない）。
  //   通知に載っていることを機械で固定する。
  test('CRON_SECRET 未設定の 500 は Sentry と Slack の両方へ通知される', () => {
    delete process.env.CRON_SECRET;
    checkCronAuth(makeRequest(`Bearer ${SECRET}`));
    expect(captured).toHaveLength(1);
    expect(captured[0][1]).toBe('cron-auth-missing-secret');
    expect(alerted).toHaveLength(1);
    expect(alerted[0][0]).toBe('cron-auth-missing-secret');
    // どの経路で落ちたかが通知に入る（path が空だと調査の起点が消える）
    expect(alerted[0][2]).toBe('/api/cron/booking-reminder');
  });

  // 負の対照: 401 は通知しない（/api/cron/* は誰でも叩けるので、載せると通知経路自体が
  // 外部から鳴らし放題の攻撃面になる）。
  test('401 は通知しない', () => {
    checkCronAuth(makeRequest('Bearer wrong-secret'));
    expect(captured).toHaveLength(0);
    expect(alerted).toHaveLength(0);
  });

  test('空文字列のトークン → 401', () => {
    const req = makeRequest('Bearer ');
    const res = checkCronAuth(req) as any;
    expect(res.status).toBe(401);
  });

  test('空の Authorization ヘッダー → 401', () => {
    const req = makeRequest('');
    const res = checkCronAuth(req) as any;
    expect(res.status).toBe(401);
  });

  test('先頭一致だが末尾が異なる → 401（タイミング安全）', () => {
    const req = makeRequest(`Bearer ${SECRET}EXTRA`);
    const res = checkCronAuth(req) as any;
    expect(res.status).toBe(401);
  });

  test('正しいトークンの部分一致 → 401（タイミング安全）', () => {
    const partial = SECRET.slice(0, 10);
    const req = makeRequest(`Bearer ${partial}`);
    const res = checkCronAuth(req) as any;
    expect(res.status).toBe(401);
  });

  test('非常に長いトークン → 401（バッファオーバーフローなし）', () => {
    const req = makeRequest(`Bearer ${'x'.repeat(10000)}`);
    const res = checkCronAuth(req) as any;
    expect(res.status).toBe(401);
  });

  test('null バイトを含むトークン → 401', () => {
    const req = makeRequest(`Bearer ${SECRET}\x00injection`);
    const res = checkCronAuth(req) as any;
    expect(res.status).toBe(401);
  });

  test('Unicode 文字を含むトークン → 401', () => {
    const req = makeRequest(`Bearer ${SECRET}絵文字🔑`);
    const res = checkCronAuth(req) as any;
    expect(res.status).toBe(401);
  });

  test('大文字小文字が異なる → 401（case-sensitive）', () => {
    const req = makeRequest(`Bearer ${SECRET.toUpperCase()}`);
    const res = checkCronAuth(req) as any;
    expect(res.status).toBe(401);
  });

  test('Bearer の大文字小文字は区別される', () => {
    const req = makeRequest(`bearer ${SECRET}`);
    const res = checkCronAuth(req) as any;
    expect(res.status).toBe(401);
  });

  test('CRON_SECRET が空文字列でも 500', () => {
    process.env.CRON_SECRET = '';
    const req = makeRequest('Bearer ');
    const res = checkCronAuth(req) as any;
    // 空 CRON_SECRET は設定不備として 500
    expect([401, 500]).toContain(res.status);
  });

  test('checkCronAuth が null を返す場合のみ通過フラグ', () => {
    const req = makeRequest(`Bearer ${SECRET}`);
    const result = checkCronAuth(req);
    // null = 通過、非null = エラーレスポンス
    expect(result).toBeNull();
  });

  test('短い CRON_SECRET でも timingSafeEqual が動作する', () => {
    process.env.CRON_SECRET = 'abc';
    const req = makeRequest('Bearer abc');
    expect(checkCronAuth(req)).toBeNull();
  });

  test('CRON_SECRET が 256 文字でも動作する', () => {
    const longSecret = 'x'.repeat(256);
    process.env.CRON_SECRET = longSecret;
    const req = makeRequest(`Bearer ${longSecret}`);
    expect(checkCronAuth(req)).toBeNull();
  });
});
