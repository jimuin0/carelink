/**
 * @jest-environment node
 *
 * SSR（document 不在）環境での getRecaptchaToken を検証。
 * node 環境では document/window が未定義のため、loadRecaptchaScript が reject し null に倒れる
 * （`typeof document === 'undefined'` 経路）。site key を設定してこの分岐へ到達させる。
 */

test('document 不在（SSR）→ null', async () => {
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = 'test-site-key';
  const { getRecaptchaToken } = await import('../recaptcha-client');
  expect(await getRecaptchaToken('review')).toBeNull();
  delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
});
