/**
 * @jest-environment jsdom
 *
 * 実機Playwright確認で発見: 施設詳細ページのSticky予約バー(.sticky-bar、fixed bottom-0
 * z-40)と本バナー(fixed bottom-0 z-50)が両方画面下部に固定表示され、本バナーが
 * 「今すぐ予約する」ボタンの前面に重なりクリックできなくなっていた(初回訪問者のみ影響)。
 * sticky-barの高さ分だけ上にオフセットして重なりを解消する。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import CookieConsent from '@/components/CookieConsent';

beforeEach(() => {
  localStorage.clear();
});

test('sticky-barが存在しない場合 → bottom:0のまま(オフセット無し)', () => {
  render(<CookieConsent />);
  const banner = screen.getByText(/当サイトではサービス向上のため/).closest('div.fixed') as HTMLElement;
  expect(banner.style.bottom).toBe('');
});

test('sticky-barが存在する場合 → その高さ分だけbottomをオフセットする', () => {
  document.body.innerHTML = '<div class="sticky-bar"></div><div id="root"></div>';
  const stickyBar = document.querySelector('.sticky-bar') as HTMLElement;
  jest.spyOn(stickyBar, 'getBoundingClientRect').mockReturnValue({ height: 76 } as DOMRect);

  const { container } = render(<CookieConsent />, { container: document.getElementById('root')! });
  const banner = container.querySelector('div.fixed') as HTMLElement;
  expect(banner.style.bottom).toBe('76px');
});
