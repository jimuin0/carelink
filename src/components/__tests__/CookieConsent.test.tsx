/**
 * @jest-environment jsdom
 *
 * 実機Playwright確認で発見: 施設詳細ページのSticky予約バー(.sticky-bar、fixed bottom-0
 * z-40)と本バナー(fixed bottom-0 z-50)が両方画面下部に固定表示され、本バナーが
 * 「今すぐ予約する」ボタンの前面に重なりクリックできなくなっていた(初回訪問者のみ影響)。
 * sticky-barの高さ分だけ上にオフセットして重なりを解消する。
 *
 * 2026年10月22日: スマホの下部ナビ（MobileBottomNav）も同じく覆っていた。下部ナビは遅延読み込みで
 * バナーより後に現れるため、現れた時点で測り直すことまで検査する。
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import CookieConsent from '@/components/CookieConsent';
import CookieSettingsButton from '@/components/CookieSettingsButton';
import {
  closeCookieSettings,
  isCookieSettingsOpen,
  openCookieSettings,
  COOKIE_CONSENT_CHANGE_EVENT,
  COOKIE_CONSENT_STORAGE_KEY,
  LEGACY_COOKIE_CONSENT_STORAGE_KEY,
  subscribeToCookieConsent,
} from '@/lib/cookie-consent';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  act(() => closeCookieSettings());
});

function bannerOf(container: HTMLElement) {
  return container.querySelector('[data-cookie-banner]') as HTMLElement;
}
const offsetOf = (banner: HTMLElement) => banner.style.getPropertyValue('--cc-offset');

test('sticky-barが存在しない場合 → 画面下端の余白（safe area）の上に出す', () => {
  render(<CookieConsent />);
  const banner = screen.getByText(/当サイトではサービス向上のため/).closest('[data-cookie-banner]') as HTMLElement;
  expect(offsetOf(banner)).toBe('env(safe-area-inset-bottom)');
});

test('sticky-barが存在する場合 → その高さ分だけ上に出す', () => {
  document.body.innerHTML = '<div class="sticky-bar"></div><div id="root"></div>';
  const stickyBar = document.querySelector('.sticky-bar') as HTMLElement;
  jest.spyOn(stickyBar, 'getBoundingClientRect').mockReturnValue({ height: 76 } as DOMRect);

  const { container } = render(<CookieConsent />, { container: document.getElementById('root')! });
  expect(offsetOf(bannerOf(container))).toBe('76px');
});

test('下部ナビ（data-bottom-fixed）がある場合 → ナビの上に出し、safe area は足さない', () => {
  document.body.innerHTML = '<nav data-bottom-fixed=""></nav><div id="root"></div>';
  jest.spyOn(document.querySelector('nav') as HTMLElement, 'getBoundingClientRect').mockReturnValue({ height: 56 } as DOMRect);

  const { container } = render(<CookieConsent />, { container: document.getElementById('root')! });
  expect(offsetOf(bannerOf(container))).toBe('56px');
});

test('下部ナビがバナーより後に現れても、現れた時点でナビの上へ移る', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const { container } = render(<CookieConsent />, { container: document.getElementById('root')! });
  expect(offsetOf(bannerOf(container))).toBe('env(safe-area-inset-bottom)');

  const nav = document.createElement('nav');
  nav.setAttribute('data-bottom-fixed', '');
  jest.spyOn(nav, 'getBoundingClientRect').mockReturnValue({ height: 56 } as DOMRect);
  await act(async () => {
    document.body.appendChild(nav);
    // MutationObserver の通知はマイクロタスクで届く
    await Promise.resolve();
  });
  expect(offsetOf(bannerOf(container))).toBe('56px');
});

// 2026年10月23日: 画面幅いっぱいの濃い帯をやめ、PC は左下の小さなカード、スマホは小さなシートにした。
test('画面幅いっぱいの帯ではなく、小さなカード（PC は左下・幅 24rem）', () => {
  const { container } = render(<CookieConsent />);
  const banner = bannerOf(container);
  expect(banner.className).toEqual(expect.stringContaining('sm:w-[24rem]'));
  expect(banner.className).toEqual(expect.stringContaining('sm:right-auto'));
  expect(banner.className).toEqual(expect.stringContaining('rounded-2xl'));
  expect(banner.className).not.toMatch(/\bbg-gray-900\b|\bright-0\b/);
});

test('ストレージに保存できない環境でも、「必須のみ」でバナーを閉じる（下部ナビやフッターを覆い続けない）', () => {
  const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
  try {
    render(<CookieConsent />);
    fireEvent.click(screen.getByRole('button', { name: '必須のみ' }));
    expect(setItem).toHaveBeenCalled();
    expect(screen.queryByText(/当サイトではサービス向上のため/)).toBeNull();
  } finally {
    setItem.mockRestore();
  }
});

test('選択を保存したら通知を出す（トップの登録 CTA はこれを受けて表示する）', () => {
  const onChange = jest.fn();
  const unsubscribe = subscribeToCookieConsent(onChange);
  render(<CookieConsent />);
  fireEvent.click(screen.getByRole('button', { name: '必須のみ' }));
  expect(onChange).toHaveBeenCalled();
  expect(localStorage.getItem('cookie-consent-v2')).toContain('"analytics":false');
  expect(screen.queryByText(/当サイトではサービス向上のため/)).toBeNull();
  unsubscribe();
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

// 切り替えの状態は色とつまみの位置でしか表しておらず、スクリーンリーダーでは
// 「分析Cookieを切り替え ボタン」としか読まれなかった（ON か OFF か分からないまま保存することになる）。
test('分析・マーケティングの切り替えは、状態を読み上げられるスイッチ（名前に状態を含めない）', () => {
  render(<CookieConsent />);
  fireEvent.click(screen.getByRole('button', { name: '設定を変更' }));
  const analytics = screen.getByRole('switch', { name: '分析Cookie' });
  const marketing = screen.getByRole('switch', { name: 'マーケティングCookie' });
  expect(analytics).toHaveAttribute('aria-checked', 'false');
  expect(marketing).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(analytics);
  expect(analytics).toHaveAttribute('aria-checked', 'true');
  expect(marketing).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(marketing);
  expect(marketing).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(analytics);
  expect(analytics).toHaveAttribute('aria-checked', 'false');
});

// Clarity は録画を送る。説明が「個人を特定するデータは収集しません」のままだと実態と合わない。
test('分析Cookieの説明は、セッション録画とそれを行わない画面を伝える', () => {
  render(<CookieConsent />);
  fireEvent.click(screen.getByRole('button', { name: '設定を変更' }));
  expect(screen.getByText(/Microsoft Clarity のヒートマップ・セッション録画/)).toBeInTheDocument();
  expect(screen.getByText(/マイページ・予約・問診・管理画面など、お客様の情報を表示する画面では録画しません/)).toBeInTheDocument();
  expect(screen.queryByText(/個人を特定するデータは収集しません/)).toBeNull();
});

// 2026年10月23日: 回答した後に設定を変える・同意を取り消す手段が画面上に無かった。
// フッターの「Cookie設定」（openCookieSettings）で開き直せる。
describe('回答後に開き直す', () => {
  const answered = (prefs: object) => localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ necessary: true, ...prefs }));

  test('回答済みでは出さず、開き直すと保存済みの選択を初期値にした詳細設定が開き、見出しへフォーカスが移る', () => {
    answered({ analytics: true, marketing: false });
    render(<CookieConsent />);
    expect(screen.queryByRole('region', { name: 'Cookieの設定' })).not.toBeInTheDocument();
    act(() => openCookieSettings());
    expect(screen.getByRole('region', { name: 'Cookieの設定' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '分析Cookie' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'マーケティングCookie' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('heading', { name: 'Cookie設定' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: '戻る' })).not.toBeInTheDocument();
  });

  test('分析Cookieを外して保存すると、同意の撤回として保存・通知して閉じ、押したボタンへフォーカスを戻す', () => {
    answered({ analytics: true, marketing: true });
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const listener = jest.fn();
    window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, listener);
    render(<CookieConsent />);
    act(() => openCookieSettings());
    fireEvent.click(screen.getByRole('switch', { name: '分析Cookie' }));
    fireEvent.click(screen.getByRole('button', { name: '選択を保存' }));
    window.removeEventListener(COOKIE_CONSENT_CHANGE_EVENT, listener);
    expect(JSON.parse(localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)!)).toEqual({ necessary: true, analytics: false, marketing: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(isCookieSettingsOpen()).toBe(false);
    expect(screen.queryByRole('region', { name: 'Cookieの設定' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test('「閉じる」は何も保存せずに閉じる。もう一度開くと保存済みの値から始まる', () => {
    answered({ analytics: false, marketing: false });
    render(<CookieConsent />);
    act(() => openCookieSettings());
    fireEvent.click(screen.getByRole('switch', { name: '分析Cookie' }));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('region', { name: 'Cookieの設定' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)!).analytics).toBe(false);
    act(() => openCookieSettings());
    expect(screen.getByRole('switch', { name: '分析Cookie' })).toHaveAttribute('aria-checked', 'false');
  });

  test('保存値が読めないときは既定（分析・マーケティングとも OFF）から始まる', () => {
    localStorage.setItem(LEGACY_COOKIE_CONSENT_STORAGE_KEY, 'accepted');
    render(<CookieConsent />);
    act(() => openCookieSettings());
    expect(screen.getByRole('switch', { name: '分析Cookie' })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'すべて同意' }));
    expect(JSON.parse(localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)!)).toEqual({ necessary: true, analytics: true, marketing: true });
  });
});

// フッターの flex に置かれると block 扱いになり、文字だけの高さ（11〜14px）では WCAG 2.5.8 の
// 24px に届かなかった（e2e/accessibility.spec.ts が検知）。呼び出し側の className に関係なく
// 部品の側で最低サイズを持つ。
test('「Cookie設定」ボタンは呼び出し側の className を保ったまま最低 24px 四方の押せる範囲を持つ', () => {
  render(<CookieSettingsButton className="hover:text-white transition-colors" />);
  const button = screen.getByRole('button', { name: 'Cookie設定' });
  expect(button.className.split(' ')).toEqual(expect.arrayContaining(['min-h-6', 'min-w-6', 'hover:text-white', 'transition-colors']));
  render(<CookieSettingsButton />);
  expect(screen.getAllByRole('button', { name: 'Cookie設定' })[1].className).toBe('min-h-6 min-w-6');
});
