/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/jsdom
 * @jest-environment-options {"url": "https://www.carelink-jp.com/search"}
 *
 * Cookie 同意の単一ソース（src/lib/cookie-consent.ts）の検査（2026年10月22日 新設）。
 *
 * 【固定したいこと】
 * - 分析タグを許すのは cookie-consent-v2 の analytics が「真偽値の true」のときだけ。
 *   旧キー（v1: 'accepted' / 'declined'）は分析の同意にしない。
 * - 保存すると同じタブへ通知が飛び、他タブの変更（storage）も拾う。
 * - 拒否したら GA の送信を止め、読み込み済みの Clarity に撤回を伝え、分析 Cookie を
 *   上位ドメイン（.carelink-jp.com）に付いたものまで期限切れにする。
 * - Clarity は公式スニペットと同じスタブを先に用意する（無いとタグが TypeError で止まる）。
 *
 * URL を www.carelink-jp.com にしているのは、GA が付ける「上位ドメインの Cookie」を
 * 実際に jsdom の Cookie 置き場へ入れて消せることを確かめるため。
 */
import {
  COOKIE_CONSENT_CHANGE_EVENT,
  COOKIE_CONSENT_STORAGE_KEY,
  LEGACY_COOKIE_CONSENT_STORAGE_KEY,
  analyticsCookieDomains,
  applyAnalyticsConsent,
  applySessionRecordingScope,
  clarityTagUrl,
  ensureClarityStub,
  expireAnalyticsCookies,
  hasAnalyticsConsent,
  hasAnsweredCookieBanner,
  readCookiePreferences,
  saveCookiePreferences,
  subscribeToCookieConsent,
} from '../cookie-consent';

type W = Window & Record<string, unknown>;
const w = window as unknown as W;

function clearCookies() {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0]!.trim();
    if (!name) continue;
    document.cookie = `${name}=; Max-Age=0; path=/`;
    document.cookie = `${name}=; Max-Age=0; path=/; domain=carelink-jp.com`;
    document.cookie = `${name}=; Max-Age=0; path=/; domain=www.carelink-jp.com`;
  }
}

function cookieNames(): string[] {
  return document.cookie.split(';').map((p) => p.split('=')[0]!.trim()).filter(Boolean).sort();
}

beforeEach(() => {
  localStorage.clear();
  clearCookies();
  delete w.clarity;
  delete w['ga-disable-G-TEST1'];
  jest.restoreAllMocks();
});

describe('readCookiePreferences / hasAnalyticsConsent', () => {
  test('未保存なら null・同意なし', () => {
    expect(readCookiePreferences()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });

  test('analytics が true のときだけ同意あり', () => {
    localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ necessary: true, analytics: true, marketing: false }));
    expect(readCookiePreferences()).toEqual({ necessary: true, analytics: true, marketing: false });
    expect(hasAnalyticsConsent()).toBe(true);
  });

  test('「必須のみ」（analytics:false）は同意なし', () => {
    localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ necessary: true, analytics: false, marketing: true }));
    expect(readCookiePreferences()).toEqual({ necessary: true, analytics: false, marketing: true });
    expect(hasAnalyticsConsent()).toBe(false);
  });

  test("真偽値でない値（'true' 文字列など）は同意にしない", () => {
    localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ analytics: 'true', marketing: 1 }));
    expect(readCookiePreferences()).toEqual({ necessary: true, analytics: false, marketing: false });
    expect(hasAnalyticsConsent()).toBe(false);
  });

  test.each([['null'], ['1'], ['"accepted"'], ['{壊れたJSON']])('壊れた保存値 %s は null', (raw) => {
    localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, raw);
    expect(readCookiePreferences()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });

  test('旧キー（v1）の accepted は分析の同意にしない', () => {
    localStorage.setItem(LEGACY_COOKIE_CONSENT_STORAGE_KEY, 'accepted');
    expect(readCookiePreferences()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });

  test('ストレージが使えない環境は同意なし（例外を外へ出さない）', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(readCookiePreferences()).toBeNull();
    expect(hasAnalyticsConsent()).toBe(false);
  });
});

describe('hasAnsweredCookieBanner', () => {
  test('未回答なら false', () => {
    expect(hasAnsweredCookieBanner()).toBe(false);
  });
  test('v2 に保存があれば回答済み', () => {
    localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ necessary: true, analytics: false, marketing: false }));
    expect(hasAnsweredCookieBanner()).toBe(true);
  });
  test('旧キー（v1）だけでも回答済み（バナーは再表示しない）', () => {
    localStorage.setItem(LEGACY_COOKIE_CONSENT_STORAGE_KEY, 'declined');
    expect(hasAnsweredCookieBanner()).toBe(true);
  });
  test('ストレージが使えない環境は未回答（バナーを出す）', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(hasAnsweredCookieBanner()).toBe(false);
  });
});

describe('saveCookiePreferences / subscribeToCookieConsent', () => {
  test('保存すると同じタブの購読者へすぐ通知する', () => {
    const onChange = jest.fn();
    const unsubscribe = subscribeToCookieConsent(onChange);
    expect(saveCookiePreferences({ necessary: true, analytics: true, marketing: false })).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(hasAnalyticsConsent()).toBe(true);
    unsubscribe();
    saveCookiePreferences({ necessary: true, analytics: false, marketing: false });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('保存できなくても通知はする（保存値を読み直すので同意は有効にならない）', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    const listener = jest.fn();
    window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, listener);
    expect(saveCookiePreferences({ necessary: true, analytics: true, marketing: true })).toBe(false);
    window.removeEventListener(COOKIE_CONSENT_CHANGE_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(hasAnalyticsConsent()).toBe(false);
  });

  test('他タブの変更（同意キー・旧キー・全消去）を拾い、無関係なキーは無視する', () => {
    const onChange = jest.fn();
    const unsubscribe = subscribeToCookieConsent(onChange);
    window.dispatchEvent(new StorageEvent('storage', { key: COOKIE_CONSENT_STORAGE_KEY }));
    window.dispatchEvent(new StorageEvent('storage', { key: LEGACY_COOKIE_CONSENT_STORAGE_KEY }));
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(onChange).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new StorageEvent('storage', { key: 'booking-draft:abc' }));
    expect(onChange).toHaveBeenCalledTimes(3);
    unsubscribe();
    window.dispatchEvent(new StorageEvent('storage', { key: COOKIE_CONSENT_STORAGE_KEY }));
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});

describe('analyticsCookieDomains', () => {
  test.each([
    ['www.carelink-jp.com', ['www.carelink-jp.com', 'carelink-jp.com']],
    ['carelink-jp.com', ['carelink-jp.com']],
    ['localhost', []],
    ['127.0.0.1', []],
    ['[::1]', []],
  ])('%s → %j', (host, expected) => {
    expect(analyticsCookieDomains(host)).toEqual(expected);
  });
});

describe('expireAnalyticsCookies', () => {
  test('GA・Clarity の Cookie だけを、上位ドメインに付いたものも含めて消す', () => {
    document.cookie = '_ga=GA1.1.111.222; path=/; domain=carelink-jp.com';
    document.cookie = '_ga_BP8GVKJ3NZ=GS1.1.1; path=/; domain=carelink-jp.com';
    document.cookie = '_clck=abc; path=/; domain=carelink-jp.com';
    document.cookie = '_clsk=def; path=/';
    document.cookie = '_gax=keep; path=/';
    document.cookie = 'sb-auth=keep; path=/';
    // 空振り防止: 消す対象が実際に入っていること。
    expect(cookieNames()).toEqual(['_clck', '_clsk', '_ga', '_ga_BP8GVKJ3NZ', '_gax', 'sb-auth']);

    expect(expireAnalyticsCookies().sort()).toEqual(['_clck', '_clsk', '_ga', '_ga_BP8GVKJ3NZ']);
    expect(cookieNames()).toEqual(['_gax', 'sb-auth']);
  });

  test('対象が無ければ何もしない', () => {
    document.cookie = 'sb-auth=keep; path=/';
    expect(expireAnalyticsCookies()).toEqual([]);
    expect(cookieNames()).toEqual(['sb-auth']);
  });
});

describe('Clarity のスタブ', () => {
  test('公式スニペットと同じく呼び出しをキューに積む（タグが window.clarity を読んでも落ちない）', () => {
    const clarity = ensureClarityStub();
    expect(typeof w.clarity).toBe('function');
    // タグ本体は先頭で window.clarity.v / .t を読む。スタブが無いとここで TypeError になっていた。
    expect(() => (w.clarity as { v?: unknown }).v).not.toThrow();
    clarity('consent');
    clarity('set', 'page', '/search');
    expect((clarity.q ?? []).map((args) => Array.from(args as ArrayLike<unknown>))).toEqual([
      ['consent'],
      ['set', 'page', '/search'],
    ]);
  });

  test('読み込み済みの clarity は置き換えない', () => {
    const loaded = jest.fn();
    w.clarity = loaded;
    expect(ensureClarityStub()).toBe(loaded);
    expect(w.clarity).toBe(loaded);
  });

  test('タグの URL は www.clarity.ms/tag/<ID>', () => {
    expect(clarityTagUrl('w1sqla5alv')).toBe('https://www.clarity.ms/tag/w1sqla5alv');
  });
});

describe('applyAnalyticsConsent', () => {
  test('同意あり: GA の送信停止を外し、Clarity に同意を伝える', () => {
    w['ga-disable-G-TEST1'] = true;
    applyAnalyticsConsent(true, { gaId: 'G-TEST1', clarityId: 'abc123' });
    expect(w['ga-disable-G-TEST1']).toBe(false);
    const clarity = w.clarity as unknown as { q: ArrayLike<unknown>[] };
    expect(clarity.q.map((a) => Array.from(a))).toEqual([['consent']]);
  });

  test('同意あり・ID 未設定: 何も定義しない', () => {
    applyAnalyticsConsent(true, {});
    expect(w.clarity).toBeUndefined();
    expect(w['ga-disable-G-TEST1']).toBeUndefined();
  });

  test('同意なし: GA を止め、読み込み済みの Clarity に撤回を伝え、分析 Cookie を消す', () => {
    const clarity = jest.fn();
    w.clarity = clarity;
    document.cookie = '_ga=GA1.1.1.2; path=/; domain=carelink-jp.com';
    document.cookie = 'sb-auth=keep; path=/';
    applyAnalyticsConsent(false, { gaId: 'G-TEST1', clarityId: 'abc123' });
    expect(w['ga-disable-G-TEST1']).toBe(true);
    expect(clarity).toHaveBeenCalledWith('consent', false);
    expect(cookieNames()).toEqual(['sb-auth']);
  });

  test('同意なし・Clarity 未読み込み: スタブを作らない（撤回のためにタグを読み込まない）', () => {
    document.cookie = '_clck=abc; path=/';
    applyAnalyticsConsent(false, { clarityId: 'abc123' });
    expect(w.clarity).toBeUndefined();
    expect(cookieNames()).toEqual([]);
  });
});

// 録画してはいけない画面（管理画面・マイページ・予約など）へのクライアント遷移で止め、戻ったら再開する。
describe('applySessionRecordingScope', () => {
  test('Clarity が無ければ何もせず、止めていない扱いにする（スタブも作らない）', () => {
    expect(applySessionRecordingScope(false, false)).toBe(false);
    expect(applySessionRecordingScope(true, true)).toBe(false);
    expect(w.clarity).toBeUndefined();
  });

  test('録画しない画面へ移ったら一度だけ止め、録画してよい画面へ戻ったら再開する', () => {
    const clarity = jest.fn();
    w.clarity = clarity;
    expect(applySessionRecordingScope(true, false)).toBe(false);
    expect(clarity).not.toHaveBeenCalled();
    expect(applySessionRecordingScope(false, false)).toBe(true);
    expect(clarity).toHaveBeenLastCalledWith('stop');
    expect(applySessionRecordingScope(false, true)).toBe(true); // 止めたまま重ねて止めない
    expect(clarity).toHaveBeenCalledTimes(1);
    expect(applySessionRecordingScope(true, true)).toBe(false);
    expect(clarity).toHaveBeenLastCalledWith('start');
    expect(clarity).toHaveBeenCalledTimes(2);
  });

  test('読み込み前のスタブには順に積む（clarity.js が読み込み時に処理する）', () => {
    const stub = ensureClarityStub();
    expect(applySessionRecordingScope(false, false)).toBe(true);
    expect(stub.q!.map((a) => Array.from(a as ArrayLike<unknown>))).toEqual([['stop']]);
  });
});
