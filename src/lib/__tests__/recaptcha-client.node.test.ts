/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * SSR（document 不在）環境での getRecaptchaToken を検証。
 * node 環境では document/window が未定義のため、loadRecaptchaScript が reject し null に倒れる
 * （`typeof document === 'undefined'` 経路）。site key を設定してこの分岐へ到達させる。
 *
 * 素の `@jest-environment node` 指定は src/lib/__tests__ の規約違反（Stryker mixin 環境を上書きし
 * L4 dry run を壊す・通常CIでも他テストの環境汚染で間欠失敗を誘発）のため mixin 形を使う。
 * jest-env-convention.test.ts がこの規約を強制している。
 */

test('document 不在（SSR）→ null', async () => {
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = 'test-site-key';
  const { getRecaptchaToken } = await import('../recaptcha-client');
  expect(await getRecaptchaToken('review')).toBeNull();
  delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
});
