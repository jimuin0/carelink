/**
 * L6 認証バイパス防止テスト — middleware.ts
 *
 * signCacheValue / verifyCacheValue / getMembershipCacheKey の
 * HMAC-SHA256 署名・検証ロジックを網羅的に検証する。
 *
 * @jest-environment node
 */
// middleware は Web Crypto API (TextEncoder / crypto.subtle) を使うため node 環境を指定。
// jsdom ではこれらがグローバルに存在しない。

jest.mock('next/server', () => ({
  NextResponse: {
    next: () => ({}),
    redirect: () => ({}),
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}));

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: () => ({
            single: async () => ({ data: null }),
          }),
        }),
      }),
    }),
  }),
}));

import { signCacheValue, verifyCacheValue, getMembershipCacheKey } from '../../middleware';

// テスト用 userId — 非シークレットの任意文字列
const TEST_USER_A = 'test-user-alpha';
const TEST_USER_B = 'test-user-beta';
const TEST_SECRET = 'test-hmac-secret-for-unit-tests';

// ---------------------------------------------------------------------------
// signCacheValue
// ---------------------------------------------------------------------------

describe('signCacheValue', () => {
  const origSecret = process.env.ADMIN_COOKIE_SECRET;

  beforeEach(() => {
    process.env.ADMIN_COOKIE_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    if (origSecret === undefined) {
      delete process.env.ADMIN_COOKIE_SECRET;
    } else {
      process.env.ADMIN_COOKIE_SECRET = origSecret;
    }
  });

  test('ADMIN_COOKIE_SECRET が設定されている場合: 非 null を返す', async () => {
    const result = await signCacheValue(TEST_USER_A, '1');
    expect(result).not.toBeNull();
  });

  test('val=1 の署名: "1." で始まる', async () => {
    const result = await signCacheValue(TEST_USER_A, '1');
    expect(result).toMatch(/^1\./);
  });

  test('val=0 の署名: "0." で始まる', async () => {
    const result = await signCacheValue(TEST_USER_A, '0');
    expect(result).toMatch(/^0\./);
  });

  test('ADMIN_COOKIE_SECRET が未設定: null を返す', async () => {
    delete process.env.ADMIN_COOKIE_SECRET;
    const result = await signCacheValue(TEST_USER_A, '1');
    expect(result).toBeNull();
  });

  test('決定論的: 同じ引数で2回呼んでも同じ値', async () => {
    const r1 = await signCacheValue(TEST_USER_A, '1');
    const r2 = await signCacheValue(TEST_USER_A, '1');
    expect(r1).toBe(r2);
  });

  test('異なる userId → 異なる署名', async () => {
    const rA = await signCacheValue(TEST_USER_A, '1');
    const rB = await signCacheValue(TEST_USER_B, '1');
    expect(rA).not.toBe(rB);
  });
});

// ---------------------------------------------------------------------------
// verifyCacheValue — 認証バイパス防止
// ---------------------------------------------------------------------------

describe('verifyCacheValue — 認証バイパス防止', () => {
  const origSecret = process.env.ADMIN_COOKIE_SECRET;

  beforeEach(() => {
    process.env.ADMIN_COOKIE_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    if (origSecret === undefined) {
      delete process.env.ADMIN_COOKIE_SECRET;
    } else {
      process.env.ADMIN_COOKIE_SECRET = origSecret;
    }
  });

  test('正当な署名 (val=1): true を返す', async () => {
    const signed = await signCacheValue(TEST_USER_A, '1');
    const result = await verifyCacheValue(TEST_USER_A, signed!);
    expect(result).toBe(true);
  });

  test('正当な署名 (val=0): false を返す', async () => {
    const signed = await signCacheValue(TEST_USER_A, '0');
    const result = await verifyCacheValue(TEST_USER_A, signed!);
    expect(result).toBe(false);
  });

  test('改ざん攻撃: val を "0" → "1" に書き換えた場合 null を返す', async () => {
    const signed = await signCacheValue(TEST_USER_A, '0');
    // "0.xxxxx..." → "1.xxxxx..." に書き換える
    const tampered = '1' + signed!.slice(1);
    const result = await verifyCacheValue(TEST_USER_A, tampered);
    expect(result).toBeNull();
  });

  test('署名改ざん: 正当な署名の末尾 1 文字を変更した場合 null を返す', async () => {
    const signed = await signCacheValue(TEST_USER_A, '1');
    const lastChar = signed!.slice(-1);
    const newChar = lastChar === 'a' ? 'b' : 'a';
    const tampered = signed!.slice(0, -1) + newChar;
    const result = await verifyCacheValue(TEST_USER_A, tampered);
    expect(result).toBeNull();
  });

  test('クロスユーザー攻撃: userId_A の署名を userId_B で検証した場合 null を返す', async () => {
    const signedForA = await signCacheValue(TEST_USER_A, '1');
    const result = await verifyCacheValue(TEST_USER_B, signedForA!);
    expect(result).toBeNull();
  });

  test('ドット区切りなし: null を返す', async () => {
    const result = await verifyCacheValue(TEST_USER_A, 'nodot');
    expect(result).toBeNull();
  });

  test('不正な val (0 でも 1 でもない): null を返す', async () => {
    // 長さ 64 のダミー hex
    const fakeHex = 'a'.repeat(64);
    const result = await verifyCacheValue(TEST_USER_A, `2.${fakeHex}`);
    expect(result).toBeNull();
  });

  test('署名が 32 バイト未満: null を返す', async () => {
    const shortHex = 'ab'.repeat(16); // 16バイト分のhex（32文字）
    const result = await verifyCacheValue(TEST_USER_A, `1.${shortHex}`);
    expect(result).toBeNull();
  });

  test('空文字: null を返す', async () => {
    const result = await verifyCacheValue(TEST_USER_A, '');
    expect(result).toBeNull();
  });

  test('ADMIN_COOKIE_SECRET が未設定: null を返す', async () => {
    const signed = await signCacheValue(TEST_USER_A, '1');
    delete process.env.ADMIN_COOKIE_SECRET;
    const result = await verifyCacheValue(TEST_USER_A, signed!);
    expect(result).toBeNull();
  });

  test('異なる secret で署名した値: null を返す（秘密鍵の違いを検出）', async () => {
    const signed = await signCacheValue(TEST_USER_A, '1');
    // secret を変えて検証
    process.env.ADMIN_COOKIE_SECRET = 'different-secret-value';
    const result = await verifyCacheValue(TEST_USER_A, signed!);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getMembershipCacheKey
// ---------------------------------------------------------------------------

describe('getMembershipCacheKey', () => {
  test('キーは "_cm_mbr_" プレフィックスで始まる', () => {
    expect(getMembershipCacheKey(TEST_USER_A)).toMatch(/^_cm_mbr_/);
  });

  test('異なる userId → 異なるキー', () => {
    const keyA = getMembershipCacheKey(TEST_USER_A);
    const keyB = getMembershipCacheKey(TEST_USER_B);
    expect(keyA).not.toBe(keyB);
  });

  test('決定論的: 同じ userId で同じキー', () => {
    expect(getMembershipCacheKey(TEST_USER_A)).toBe(getMembershipCacheKey(TEST_USER_A));
  });

  test('ハイフンを除去した先頭 16 文字がキーに含まれる', () => {
    // userId = 'test-user-alpha'
    // ハイフン除去 = 'testuseralpha'（13文字）→ slice(0,16) = 'testuseralpha'
    const key = getMembershipCacheKey(TEST_USER_A);
    const expectedSuffix = TEST_USER_A.replace(/-/g, '').slice(0, 16);
    expect(key).toBe(`_cm_mbr_${expectedSuffix}`);
  });
});
