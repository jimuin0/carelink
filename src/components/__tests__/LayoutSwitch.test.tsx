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
let mockSearch = new URLSearchParams();
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname, useSearchParams: () => mockSearch }));
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

// 録画しない画面（src/lib/session-recording-scope.ts）の本文は Clarity のマスク対象にする。
// 公開ページで読み込んだ Clarity がクライアント遷移の直後に描画を拾っても、文字を残さないための守り。
describe('Clarity のマスク', () => {
  // 管理画面はフッターを持たないので、<main> だけを取り出す。
  function mainAt(pathname: string) {
    mockPathname = pathname;
    render(<LayoutSwitch aiEnabled={false}><p>本文</p></LayoutSwitch>);
    return screen.getByRole('main');
  }

  test.each(['/admin/customers', '/mypage/bookings', '/auth/login', '/facility/some-salon/booking', '/register', '/intake/some-salon'])(
    '%s の本文はマスクする',
    (path) => {
      expect(mainAt(path)).toHaveAttribute('data-clarity-mask', 'true');
    },
  );

  test.each(['/', '/search', '/facility/some-salon', '/blog', '/tokyo'])('%s の本文はマスクしない（録画してよい公開ページ）', (path) => {
    expect(mainAt(path)).not.toHaveAttribute('data-clarity-mask');
  });
});

// 店舗向けページ（くすみ系）は来院者向けの濃いフッターではなく、同じテーマの簡素なフッターにする（2026年10月23日）。
describe('店舗向けページのフッター', () => {
  test.each(['/register', '/register/complete'])('%s は表記と問い合わせだけの簡素なフッター', (path) => {
    const { footer } = renderAt(path);
    expect(screen.queryByTestId('plain-footer')).toBeNull();
    expect(footer.className).toContain('theme-ecru');
    const hrefs = Array.from(footer.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/legal', '/terms', '/privacy', '/contact']);
    expect(footer).toHaveTextContent('運営：神原良祐（HALグループ）');
  });

  test('来院者向けページは従来のフッター（負の対照）', () => {
    renderAt('/contact');
    expect(screen.getByTestId('plain-footer')).toBeInTheDocument();
  });
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
  test('掲載申込の続きとして開いた店舗アカウント作成画面では来院者向けナビを出さない', () => {
    mockPathname = '/auth/signup';
    mockSearch = new URLSearchParams({ redirect: '/admin/onboarding?handoff=registration' });
    const { unmount } = render(<MobileBottomNav />);
    expect(screen.queryByRole('navigation', { name: 'メインナビゲーション' })).toBeNull();
    unmount();
    // 来院者の新規登録では従来どおり出す（負の対照）
    mockSearch = new URLSearchParams();
    render(<MobileBottomNav />);
    expect(screen.getByRole('navigation', { name: 'メインナビゲーション' })).toBeInTheDocument();
    mockSearch = new URLSearchParams();
  });
});
