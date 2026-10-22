/**
 * @jest-environment jsdom
 *
 * 紹介リンク（トップの ?ref=コード）の案内。
 * 回帰: 以前は ?ref= をどこも読まず、リンクから来てもコードの行き先が無かった。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import ReferralInviteNotice from '../ReferralInviteNotice';

afterEach(() => { window.history.pushState({}, '', '/'); });

test('紹介リンクで来たら、コードを示して登録・ログイン後の入力画面へ案内する', async () => {
  window.history.pushState({}, '', '/?ref=wxyz2345');
  render(<ReferralInviteNotice />);
  expect((await screen.findByRole('region', { name: '紹介コードのご案内' })).querySelector('p')?.textContent)
    .toBe('紹介コード「WXYZ2345」が届いています。会員登録のあと、初回のご予約の前に入力すると、初回のご予約完了で300ポイントをお受け取りいただけます。');
  expect(screen.getByRole('link', { name: '会員登録してコードを入力' }))
    .toHaveAttribute('href', `/auth/signup?redirect=${encodeURIComponent('/mypage/referral?ref=WXYZ2345')}`);
  expect(screen.getByRole('link', { name: 'ログインして入力' }))
    .toHaveAttribute('href', `/auth/login?redirect=${encodeURIComponent('/mypage/referral?ref=WXYZ2345')}`);
});

test.each([['/'], ['/?ref='], ['/?ref=not-a-code'], ['/?utm_source=x']])('%s では何も描かない', (url) => {
  window.history.pushState({}, '', url);
  const { container } = render(<ReferralInviteNotice />);
  expect(container).toBeEmptyDOMElement();
});
