/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/jsdom
 *
 * getRecaptchaToken の分岐網羅テスト。
 * site key 未設定（dev/CI）・grecaptcha 既存・スクリプトロード成功/失敗・実行失敗・document 不在を検証。
 */

const SITE = 'test-site-key';

function setSiteKey(v: string | undefined) {
  if (v === undefined) delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  else process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = v;
}

afterEach(() => {
  jest.resetModules();
  delete (window as unknown as { grecaptcha?: unknown }).grecaptcha;
  setSiteKey(undefined);
  jest.restoreAllMocks();
});

test('site key 未設定 → null（token を送らない）', async () => {
  setSiteKey(undefined);
  const { getRecaptchaToken } = await import('../recaptcha-client');
  expect(await getRecaptchaToken('review')).toBeNull();
});

test('grecaptcha 既存 → 実トークンを返す', async () => {
  setSiteKey(SITE);
  (window as unknown as { grecaptcha: unknown }).grecaptcha = {
    ready: (cb: () => void) => cb(),
    execute: jest.fn().mockResolvedValue('tok-123'),
  };
  const { getRecaptchaToken } = await import('../recaptcha-client');
  expect(await getRecaptchaToken('review')).toBe('tok-123');
});

test('2回目の取得はスクリプトキャッシュを再利用する', async () => {
  setSiteKey(SITE);
  (window as unknown as { grecaptcha: unknown }).grecaptcha = {
    ready: (cb: () => void) => cb(),
    execute: jest.fn().mockResolvedValue('tok'),
  };
  const { getRecaptchaToken } = await import('../recaptcha-client');
  await getRecaptchaToken('review');
  // 2回目は loadRecaptchaScript の `if (scriptPromise) return scriptPromise` 経路。
  expect(await getRecaptchaToken('review')).toBe('tok');
});

test('execute が throw → null（fail-closed）', async () => {
  setSiteKey(SITE);
  (window as unknown as { grecaptcha: unknown }).grecaptcha = {
    ready: (cb: () => void) => cb(),
    execute: jest.fn().mockRejectedValue(new Error('exec failed')),
  };
  const { getRecaptchaToken } = await import('../recaptcha-client');
  expect(await getRecaptchaToken('review')).toBeNull();
});

test('スクリプトロード成功だが grecaptcha 未注入 → null', async () => {
  setSiteKey(SITE);
  const fakeScript: Record<string, unknown> = {};
  jest.spyOn(document, 'createElement').mockReturnValue(fakeScript as unknown as HTMLElement);
  jest.spyOn(document.head, 'appendChild').mockImplementation(((node: unknown) => {
    Promise.resolve().then(() => (fakeScript.onload as () => void)());
    return node;
  }) as typeof document.head.appendChild);
  const { getRecaptchaToken } = await import('../recaptcha-client');
  expect(await getRecaptchaToken('review')).toBeNull();
});

test('スクリプトロード失敗 → null（onerror）', async () => {
  setSiteKey(SITE);
  const fakeScript: Record<string, unknown> = {};
  jest.spyOn(document, 'createElement').mockReturnValue(fakeScript as unknown as HTMLElement);
  jest.spyOn(document.head, 'appendChild').mockImplementation(((node: unknown) => {
    Promise.resolve().then(() => (fakeScript.onerror as () => void)());
    return node;
  }) as typeof document.head.appendChild);
  const { getRecaptchaToken } = await import('../recaptcha-client');
  expect(await getRecaptchaToken('review')).toBeNull();
});

// document 不在（SSR）経路は node 環境が必要なため recaptcha-client.node.test.ts に分離。
