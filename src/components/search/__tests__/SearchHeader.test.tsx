/**
 * @jest-environment jsdom
 *
 * 検索サイト側のヘッダー（トップ・検索・施設ページ）。
 *
 * 【2026年10月23日】
 * - 業種 8 つを横に並べていたため 1280px でもヘッダーがはみ出して横スクロールが出ていた
 *   （本番で scrollWidth 1282）。デスクトップは「業種から探す」1 つの開閉ボタンにまとめる。
 * - 掲載を考えている店舗の入口「掲載をお考えの方」（/register）が一般の Header にしか無く、
 *   トップ・検索・施設ページから来た店舗が辿り着けなかった。デスクトップとスマホのメニューの両方に置く。
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { businessTypes } from '@/lib/constants';
import { businessTypeLabel } from '@/lib/business-type-label';
import SearchHeader from '../SearchHeader';

jest.mock('next/dynamic', () => ({ __esModule: true, default: () => function LocaleStub() { return null; } }));
jest.mock('@/components/auth/AuthButton', () => ({ __esModule: true, default: () => <button type="button">ログイン</button> }));

const desktopNav = () => screen.getByRole('navigation', { name: 'メインナビゲーション' });
const mobileNav = () => screen.getByRole('navigation', { name: 'モバイルメニュー', hidden: true });

test('デスクトップは業種を「業種から探す」1 つにまとめ、開くと全業種へのリンクが出る', () => {
  render(<SearchHeader />);
  const nav = desktopNav();
  const toggle = within(nav).getByRole('button', { name: '業種から探す' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  // 閉じている間は業種のリンクを並べない（横幅を取らない）
  expect(within(nav).queryByRole('link', { name: businessTypeLabel(businessTypes[0]!) })).not.toBeInTheDocument();

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
  const links = within(panel).getAllByRole('link');
  expect(links.map((l) => l.textContent)).toEqual(businessTypes.map(businessTypeLabel));
  expect(links[0]).toHaveAttribute('href', `/search?type=${encodeURIComponent(businessTypes[0]!)}`);

  // リンクを押す・Esc・外側のクリックで閉じる
  fireEvent.click(links[0]!);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveFocus();
  fireEvent.click(toggle);
  fireEvent.keyDown(document, { key: 'Enter' });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.mouseDown(within(panel.ownerDocument.body).getByRole('banner'));
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('フォーカスがメニューの外へ出たら閉じ、中で動く間は開いたまま', () => {
  render(<SearchHeader />);
  const toggle = within(desktopNav()).getByRole('button', { name: '業種から探す' });
  fireEvent.click(toggle);
  const firstLink = within(document.getElementById(toggle.getAttribute('aria-controls')!)!).getAllByRole('link')[0]!;
  fireEvent.blur(toggle, { relatedTarget: firstLink });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.blur(firstLink, { relatedTarget: within(desktopNav()).getByRole('link', { name: 'エリアから探す' }) });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('「掲載をお考えの方」をデスクトップとスマホのメニューの両方に置く（行き先は /register）', () => {
  render(<SearchHeader />);
  expect(within(desktopNav()).getByRole('link', { name: '掲載をお考えの方' })).toHaveAttribute('href', '/register');
  expect(within(mobileNav()).getByRole('link', { name: '掲載をお考えの方', hidden: true })).toHaveAttribute('href', '/register');
  // 掲載中の店舗の管理画面入口も従来どおり両方にある
  expect(within(desktopNav()).getByRole('link', { name: '店舗ログイン' })).toHaveAttribute('href', '/auth/login?redirect=/admin');
  expect(within(mobileNav()).getByRole('link', { name: '店舗ログイン', hidden: true })).toHaveAttribute('href', '/auth/login?redirect=/admin');
});

test('スマホのメニューは業種を一覧のまま出し、開閉ボタンで開く', () => {
  render(<SearchHeader />);
  const menu = screen.getByRole('button', { name: 'メニュー' });
  fireEvent.click(menu);
  expect(menu).toHaveAttribute('aria-expanded', 'true');
  const links = within(mobileNav()).getAllByRole('link', { hidden: true }).map((l) => l.textContent);
  expect(links).toEqual(expect.arrayContaining(businessTypes.map(businessTypeLabel)));
  fireEvent.click(within(mobileNav()).getByRole('link', { name: '掲載をお考えの方', hidden: true }));
  expect(menu).toHaveAttribute('aria-expanded', 'false');
});
