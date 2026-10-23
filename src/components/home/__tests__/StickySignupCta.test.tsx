/**
 * トップのスマホ向け会員登録 CTA の検査（2026年10月22日）。
 *
 * 以前は fixed bottom-0 z-50 で、下部ナビ・Cookie 同意バナーの「必須のみ／すべて同意」・
 * フッターの利用規約／特商法表記をまとめて覆っていた（本番・iPhone 13 で実測）。
 * - 同意バナーが出ている間は出さず、選択が保存された時点で出す
 * - 下部ナビのすぐ上に、fixed ではなく sticky で出す（ページ末尾ではフッターを覆わない）
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import StickySignupCta from '../StickySignupCta';
import { COOKIE_CONSENT_CHANGE_EVENT, COOKIE_CONSENT_STORAGE_KEY, closeCookieSettings, openCookieSettings } from '@/lib/cookie-consent';

function notifyCookieConsentChanged() {
  window.dispatchEvent(new Event(COOKIE_CONSENT_CHANGE_EVENT));
}

const mockGetUser = jest.fn();
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({ auth: { getUser: () => mockGetUser() } }),
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mockGetUser.mockReset().mockResolvedValue({ data: { user: null } });
});

async function renderCta() {
  const view = render(<StickySignupCta />);
  // getUser の解決を待つ
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

test('同意バナーが出ている間（選択が未保存）は出さず、保存された時点で出す', async () => {
  await renderCta();
  expect(screen.queryByRole('link', { name: '無料で会員登録する' })).toBeNull();

  act(() => {
    localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ necessary: true, analytics: false, marketing: false }));
    notifyCookieConsentChanged();
  });
  expect(screen.getByRole('link', { name: '無料で会員登録する' })).toHaveAttribute('href', '/auth/signup');
});

test('下部ナビの上に sticky で出す（画面下端に fixed で被せない）', async () => {
  localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, '{}');
  const { container } = await renderCta();
  const bar = container.querySelector('[data-sticky-signup-cta]') as HTMLElement;
  expect(bar).not.toBeNull();
  expect(bar.className).toContain('sticky');
  expect(bar.className).toContain('bottom-[var(--mobile-nav-height)]');
  expect(bar.className).not.toMatch(/(^|\s)fixed(\s|$)/);
  expect(bar.className).not.toMatch(/(^|\s)bottom-0(\s|$)/);
});

test('ログイン済みなら出さない', async () => {
  localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, '{}');
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  await renderCta();
  expect(screen.queryByRole('link', { name: '無料で会員登録する' })).toBeNull();
});

test('閉じたらこのセッションでは出さない', async () => {
  localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, '{}');
  const { unmount } = await renderCta();
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
  expect(screen.queryByRole('link', { name: '無料で会員登録する' })).toBeNull();
  unmount();
  await renderCta();
  expect(screen.queryByRole('link', { name: '無料で会員登録する' })).toBeNull();
  expect(mockGetUser).toHaveBeenCalledTimes(1);
});

// 2026年10月23日: フッターの「Cookie設定」でバナーを開き直している間は出さない（下部ナビ・CTA・バナーの 3 段にしない）。
test('Cookie の設定を開き直している間は出さず、閉じたら戻す', async () => {
  localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, '{}');
  await renderCta();
  expect(screen.getByRole('link', { name: '無料で会員登録する' })).toBeInTheDocument();
  act(() => openCookieSettings());
  expect(screen.queryByRole('link', { name: '無料で会員登録する' })).toBeNull();
  act(() => closeCookieSettings());
  expect(screen.getByRole('link', { name: '無料で会員登録する' })).toBeInTheDocument();
});
