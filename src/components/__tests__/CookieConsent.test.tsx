/**
 * @jest-environment jsdom
 *
 * 実機Playwright確認で発見: 施設詳細ページのSticky予約バー(.sticky-bar、fixed bottom-0
 * z-40)と本バナー(fixed bottom-0 z-50)が両方画面下部に固定表示され、本バナーが
 * 「今すぐ予約する」ボタンの前面に重なりクリックできなくなっていた(初回訪問者のみ影響)。
 * sticky-barの高さ分だけ上にオフセットして重なりを解消する。
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import CookieConsent from '@/components/CookieConsent';
import {
  COOKIE_CONSENT_CHANGE_EVENT,
  COOKIE_CONSENT_STORAGE_KEY,
  LEGACY_COOKIE_CONSENT_STORAGE_KEY,
} from '@/lib/cookie-consent';

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

// 2026年10月22日: 選択は保存されるだけで計測タグに伝わっていなかった。保存と同時に
// 同じタブへ通知し（AnalyticsGate がこれを購読する）、他タブでの回答にも追従する。
describe('保存と通知（src/lib/cookie-consent.ts）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test.each([
    ['必須のみ', { necessary: true, analytics: false, marketing: false }],
    ['すべて同意', { necessary: true, analytics: true, marketing: true }],
  ])('「%s」は選択を保存し、同じタブへ変更を通知する', (label, expected) => {
    const listener = jest.fn();
    window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, listener);
    render(<CookieConsent />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    window.removeEventListener(COOKIE_CONSENT_CHANGE_EVENT, listener);
    expect(JSON.parse(localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)!)).toEqual(expected);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: 'Cookieの設定' })).not.toBeInTheDocument();
  });

  test('他タブで回答されたら、このタブのバナーも閉じる', () => {
    render(<CookieConsent />);
    expect(screen.getByRole('region', { name: 'Cookieの設定' })).toBeInTheDocument();
    act(() => {
      localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ necessary: true, analytics: false, marketing: false }));
      window.dispatchEvent(new StorageEvent('storage', { key: COOKIE_CONSENT_STORAGE_KEY }));
    });
    expect(screen.queryByRole('region', { name: 'Cookieの設定' })).not.toBeInTheDocument();
  });

  test('旧キー（v1）に回答があればバナーは出さない（従来どおり）', () => {
    localStorage.setItem(LEGACY_COOKIE_CONSENT_STORAGE_KEY, 'accepted');
    render(<CookieConsent />);
    expect(screen.queryByRole('region', { name: 'Cookieの設定' })).not.toBeInTheDocument();
  });
});
