/** @jest-environment node */
import type { Metadata } from 'next';

/**
 * WCAG 2.4.2（ページタイトル）。ログイン・新規登録・パスワード再設定・申込の復旧の各画面は
 * クライアントコンポーネントで metadata を持てず、全て既定の「CareLink | …予約」になっていた
 * （タブ・履歴・スクリーンリーダーでどの画面か区別できない）。各ルートの layout で付ける。
 * ルートの title.template（'%s | CareLink'）が付くので、ここでは「| CareLink」を書かない。
 */
const ROUTES: [string, Metadata, string][] = [
  ['/auth/login', require('../app/auth/login/layout').metadata, 'ログイン'],
  ['/auth/signup', require('../app/auth/signup/layout').metadata, '新規登録'],
  ['/auth/forgot-password', require('../app/auth/forgot-password/layout').metadata, 'パスワードの再設定'],
  ['/auth/reset-password', require('../app/auth/reset-password/layout').metadata, '新しいパスワードを設定'],
  ['/register/recover', require('../app/register/recover/layout').metadata, '送信済みの掲載申込を復旧'],
];

test.each(ROUTES)('%s has its own page title', (_route, metadata, title) => {
  expect(metadata.title).toBe(title);
  expect(String(metadata.title)).not.toContain('CareLink');
});

test('titles are distinct', () => {
  expect(new Set(ROUTES.map(([, metadata]) => metadata.title)).size).toBe(ROUTES.length);
});

test('the recovery screen is not indexed', () => {
  expect(require('../app/register/recover/layout').metadata.robots).toEqual({ index: false, follow: false });
});
