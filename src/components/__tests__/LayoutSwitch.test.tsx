/**
 * 検索サイト側のレイアウトで、画面下部の固定バーの逃げがフッターに付くことの検査（2026年10月22日）。
 *
 * 以前は下部ナビ分の逃げ（pb-14）を <main> に付けていたが、フッターは <main> の外・後ろにあるため、
 * 一番下までスクロールしてもフッター最終行の「プライバシーポリシー／利用規約／特定商取引法に基づく表記」が
 * 下部ナビ（施設詳細では予約バー）の下に隠れて押せなかった（本番・iPhone 13 で実測）。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import LayoutSwitch from '../LayoutSwitch';
import MobileBottomNav from '../search/MobileBottomNav';

let mockPathname = '/search';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }));
jest.mock('../search/SearchHeader', () => ({ __esModule: true, default: () => null }));
jest.mock('../Header', () => ({ __esModule: true, default: () => null }));
jest.mock('../Footer', () => ({ __esModule: true, default: () => <footer data-testid="plain-footer" /> }));

function renderAt(pathname: string) {
  mockPathname = pathname;
  render(<LayoutSwitch aiEnabled={false}><p>本文</p></LayoutSwitch>);
  return {
    main: screen.getByRole('main'),
    footer: screen.getByRole('contentinfo'),
  };
}

test('下部ナビのページでは、逃げを <main> ではなくフッターに付ける', () => {
  const { main, footer } = renderAt('/auth/login');
  expect(main.className).not.toMatch(/pb-/);
  expect(footer.className).toContain('pb-[var(--mobile-nav-height)]');
  expect(footer.className).toContain('lg:pb-0');
  expect(screen.getByRole('link', { name: '特定商取引法に基づく表記' })).toHaveAttribute('href', '/legal');
});

test('検索結果では「絞り込み」ボタンの上端まで逃げを伸ばす', () => {
  const { footer } = renderAt('/search');
  expect(footer.className).toContain('pb-[calc(var(--mobile-nav-height)+4.5rem)]');
});

test('施設詳細では予約バーぶんの逃げをフッターに付ける', () => {
  const { footer } = renderAt('/facility/some-salon');
  expect(footer.className).toContain('pb-[var(--booking-bar-clearance)]');
});

test('固定バーの無いページでは逃げを付けない', () => {
  const { footer } = renderAt('/facility/some-salon/booking');
  expect(footer.className).not.toMatch(/pb-\[/);
});

describe('MobileBottomNav', () => {
  test('下部ナビは固定の高さで、同意バナーが避ける目印を持つ', () => {
    mockPathname = '/search';
    render(<MobileBottomNav />);
    const nav = screen.getByRole('navigation', { name: 'メインナビゲーション' });
    expect(nav).toHaveAttribute('data-bottom-fixed');
    expect(nav.className).toContain('h-[var(--mobile-nav-height)]');
  });

  test('施設詳細（予約バーを出す）では出さない', () => {
    mockPathname = '/facility/some-salon';
    render(<MobileBottomNav />);
    expect(screen.queryByRole('navigation', { name: 'メインナビゲーション' })).toBeNull();
  });
});
