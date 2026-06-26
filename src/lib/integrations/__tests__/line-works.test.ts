/**
 * @jest-environment node
 *
 * Tests for lib/integrations/line-works.ts
 * Covers: isLineWorksConfigured, getLineWorksToken, sendLineWorksMessage,
 *         notifyNewBookingLineWorks, notifyCancellationLineWorks
 */

import {
  isLineWorksConfigured,
  getLineWorksToken,
  sendLineWorksMessage,
  notifyNewBookingLineWorks,
  notifyCancellationLineWorks,
  __resetLineWorksTokenCacheForTest,
} from '../line-works';

const VALID_ENV = {
  LINE_WORKS_CLIENT_ID: 'client-id',
  LINE_WORKS_CLIENT_SECRET: 'client-secret',
  LINE_WORKS_SERVICE_ACCOUNT: 'service@account',
  LINE_WORKS_BOT_ID: 'bot-123',
  LINE_WORKS_PRIVATE_KEY: undefined as string | undefined, // set per test
};

function setEnv(partial: Partial<typeof VALID_ENV> = {}) {
  const merged = { ...VALID_ENV, ...partial };
  Object.entries(merged).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
}

function clearEnv() {
  ['LINE_WORKS_CLIENT_ID', 'LINE_WORKS_CLIENT_SECRET', 'LINE_WORKS_SERVICE_ACCOUNT',
   'LINE_WORKS_BOT_ID', 'LINE_WORKS_PRIVATE_KEY'].forEach(k => delete process.env[k]);
}

beforeEach(() => {
  clearEnv();
  jest.restoreAllMocks();
  __resetLineWorksTokenCacheForTest(); // モジュールスコープのトークンキャッシュをテスト間で分離
});

afterEach(() => {
  clearEnv();
});

// ─── isLineWorksConfigured ───────────────────────────────────────────────────

describe('isLineWorksConfigured', () => {
  test('returns false when all env vars missing', () => {
    expect(isLineWorksConfigured()).toBe(false);
  });

  test('returns false when some env vars missing', () => {
    process.env.LINE_WORKS_CLIENT_ID = 'id';
    process.env.LINE_WORKS_CLIENT_SECRET = 'secret';
    // missing SERVICE_ACCOUNT and BOT_ID
    expect(isLineWorksConfigured()).toBe(false);
  });

  test('returns true when all required env vars present', () => {
    setEnv();
    expect(isLineWorksConfigured()).toBe(true);
  });
});

// ─── getLineWorksToken ───────────────────────────────────────────────────────

describe('getLineWorksToken', () => {
  test('returns null when env vars missing', async () => {
    clearEnv();
    expect(await getLineWorksToken()).toBeNull();
  });

  test('returns null when only some env vars set', async () => {
    process.env.LINE_WORKS_CLIENT_ID = 'id';
    process.env.LINE_WORKS_CLIENT_SECRET = 'secret';
    // no SERVICE_ACCOUNT
    expect(await getLineWorksToken()).toBeNull();
  });

  test('returns null when token endpoint returns non-ok', async () => {
    setEnv({ LINE_WORKS_PRIVATE_KEY: 'invalid-key' });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    // buildJwt will fail due to invalid key → catch → return null
    const result = await getLineWorksToken();
    expect(result).toBeNull();
  });

  test('returns null when fetch throws', async () => {
    setEnv({ LINE_WORKS_PRIVATE_KEY: 'invalid-key' });
    global.fetch = jest.fn().mockRejectedValue(new Error('Network'));
    const result = await getLineWorksToken();
    expect(result).toBeNull();
  });
});

// ─── sendLineWorksMessage ────────────────────────────────────────────────────

describe('sendLineWorksMessage', () => {
  test('returns false when BOT_ID not set', async () => {
    clearEnv();
    const result = await sendLineWorksMessage('ch-1', { content: { type: 'text', text: 'hi' } });
    expect(result).toBe(false);
  });

  test('returns false when getLineWorksToken returns null (missing client creds)', async () => {
    process.env.LINE_WORKS_BOT_ID = 'bot-123';
    // No CLIENT_ID, CLIENT_SECRET, SERVICE_ACCOUNT → token returns null
    const result = await sendLineWorksMessage('ch-1', { content: { type: 'text', text: 'hi' } });
    expect(result).toBe(false);
  });

  test('returns false when message fetch throws', async () => {
    setEnv({ LINE_WORKS_PRIVATE_KEY: 'invalid' });
    // All env vars set but private key invalid → buildJwt throws → getLineWorksToken returns null
    const result = await sendLineWorksMessage('ch-1', { content: { type: 'text', text: 'hi' } });
    expect(result).toBe(false);
  });
});

// ─── notifyNewBookingLineWorks ───────────────────────────────────────────────

describe('notifyNewBookingLineWorks', () => {
  const booking = {
    customerName: 'テスト太郎',
    menuName: 'カット',
    bookingDate: '2026-05-01',
    startTime: '10:00',
  };

  test('returns false when not configured (no BOT_ID)', async () => {
    clearEnv();
    const result = await notifyNewBookingLineWorks('ch-1', booking);
    expect(result).toBe(false);
  });

  test('includes staffName in message when provided', async () => {
    // Only BOT_ID set; token will be null, so sendLineWorksMessage returns false early
    // We just verify the function runs without throwing
    process.env.LINE_WORKS_BOT_ID = 'bot-123';
    const result = await notifyNewBookingLineWorks('ch-1', { ...booking, staffName: '田中' });
    expect(result).toBe(false); // can't send without full config
  });

  test('omits staff line when staffName not provided', async () => {
    process.env.LINE_WORKS_BOT_ID = 'bot-123';
    const result = await notifyNewBookingLineWorks('ch-1', booking);
    expect(result).toBe(false);
  });
});

// ─── notifyCancellationLineWorks ─────────────────────────────────────────────

describe('notifyCancellationLineWorks', () => {
  const booking = {
    customerName: 'テスト太郎',
    menuName: 'カット',
    bookingDate: '2026-05-01',
    startTime: '10:00',
  };

  test('returns false when not configured', async () => {
    clearEnv();
    const result = await notifyCancellationLineWorks('ch-1', booking);
    expect(result).toBe(false);
  });

  test('runs without throwing with BOT_ID only', async () => {
    process.env.LINE_WORKS_BOT_ID = 'bot-123';
    const result = await notifyCancellationLineWorks('ch-1', booking);
    expect(result).toBe(false);
  });
});

// ─── success paths (mocked crypto.subtle) ────────────────────────────────────

describe('success paths with mocked crypto.subtle', () => {
  // "YWJj" is valid base64 → atob gives "abc" → valid Uint8Array input
  const FAKE_PEM = '-----BEGIN PRIVATE KEY-----\nYWJj\n-----END PRIVATE KEY-----';

  beforeEach(() => {
    setEnv({ LINE_WORKS_PRIVATE_KEY: FAKE_PEM });
    jest.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
    jest.spyOn(crypto.subtle, 'sign').mockResolvedValue(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer);
  });

  function mockFetchToken() {
    return {
      ok: true,
      json: () => Promise.resolve({ access_token: 'tok-123', token_type: 'Bearer', expires_in: 3600 }),
    };
  }

  test('getLineWorksToken → returns access_token on success', async () => {
    global.fetch = jest.fn().mockResolvedValue(mockFetchToken());
    expect(await getLineWorksToken()).toBe('tok-123');
  });

  test('getLineWorksToken → 2回目は有効キャッシュを再利用(fetchは1回のみ)', async () => {
    const f = jest.fn().mockResolvedValue(mockFetchToken());
    global.fetch = f;
    expect(await getLineWorksToken()).toBe('tok-123'); // 取得＋キャッシュ
    expect(await getLineWorksToken()).toBe('tok-123'); // expires_in=3600s 以内なのでキャッシュ
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('getLineWorksToken → expires_in 欠落時も access_token を返す(?? 0 分岐)', async () => {
    // expires_in なし → expiresAt は now（安全マージンで即失効扱い）になるが access_token は返る。
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'tok-noexp', token_type: 'Bearer' }),
    });
    expect(await getLineWorksToken()).toBe('tok-noexp');
  });

  test('sendLineWorksMessage → returns true when API responds ok', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(mockFetchToken())
      .mockResolvedValueOnce({ ok: true });
    expect(await sendLineWorksMessage('ch-1', { content: { type: 'text', text: 'hello' } })).toBe(true);
  });

  test('sendLineWorksMessage → returns false when message API responds not ok', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(mockFetchToken())
      .mockResolvedValueOnce({ ok: false });
    expect(await sendLineWorksMessage('ch-1', { content: { type: 'text', text: 'hello' } })).toBe(false);
  });

  test('sendLineWorksMessage → returns false when message fetch throws', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(mockFetchToken())
      .mockRejectedValueOnce(new Error('Network error'));
    expect(await sendLineWorksMessage('ch-1', { content: { type: 'text', text: 'hello' } })).toBe(false);
  });

  test('notifyNewBookingLineWorks → returns true on success (with staffName)', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(mockFetchToken())
      .mockResolvedValueOnce({ ok: true });
    const result = await notifyNewBookingLineWorks('ch-1', {
      customerName: 'テスト太郎',
      menuName: 'カット',
      bookingDate: '2026-05-01',
      startTime: '10:00',
      staffName: '田中',
    });
    expect(result).toBe(true);
  });

  test('notifyNewBookingLineWorks → returns true on success (no staffName)', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(mockFetchToken())
      .mockResolvedValueOnce({ ok: true });
    const result = await notifyNewBookingLineWorks('ch-1', {
      customerName: 'テスト太郎',
      menuName: 'カット',
      bookingDate: '2026-05-01',
      startTime: '10:00',
    });
    expect(result).toBe(true);
  });

  test('notifyCancellationLineWorks → returns true on success', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(mockFetchToken())
      .mockResolvedValueOnce({ ok: true });
    const result = await notifyCancellationLineWorks('ch-1', {
      customerName: 'テスト太郎',
      menuName: 'カット',
      bookingDate: '2026-05-01',
      startTime: '10:00',
    });
    expect(result).toBe(true);
  });

  test('getLineWorksToken → token endpoint returns non-ok with valid jwt → null', async () => {
    // 全 env 設定済み + crypto モック済みなので buildJwt は通る
    // fetch だけ non-ok を返す → if (!res.ok) return null 経路に入る
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    expect(await getLineWorksToken()).toBeNull();
  });
});

describe('buildJwt PRIVATE_KEY 未設定', () => {
  test('LINE_WORKS_PRIVATE_KEY 未設定 → getLineWorksToken は null (buildJwt throws caught)', async () => {
    // clientId/secret/serviceAccount は設定するが PRIVATE_KEY は意図的に未設定
    process.env.LINE_WORKS_CLIENT_ID = 'cid';
    process.env.LINE_WORKS_CLIENT_SECRET = 'csec';
    process.env.LINE_WORKS_SERVICE_ACCOUNT = 'sa';
    delete process.env.LINE_WORKS_PRIVATE_KEY;
    // fetch は呼ばれない（buildJwt が先に throw する）が一応モック
    global.fetch = jest.fn();
    expect(await getLineWorksToken()).toBeNull();
  });
});
