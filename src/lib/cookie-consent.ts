/**
 * Cookie 同意（バナーの選択）と、それに従属する計測タグの単一ソース。
 *
 * 🔴 なぜ必要か（2026年10月22日）
 * バナーは「必須のみ」「分析 Cookie の切り替え」を選べるように見せていたが、選択は localStorage に
 * 保存されるだけで、どこからも読まれていなかった。root layout は GA4 と Microsoft Clarity を
 * 同意と無関係に全ページで読み込んでおり、拒否した来訪者にも計測が続いていた。
 * 読み取り・保存・変更通知をここに集め、計測タグ（components/AnalyticsGate.tsx）とバナー
 * （components/CookieConsent.tsx）の両方が同じ判定を使う。
 *
 * - 分析タグを読み込んでよいのは `cookie-consent-v2` の analytics が true のときだけ。
 * - 旧キー `cookie-consent`（v1。値は 'accepted' / 'declined' で区分が無い）は、
 *   バナーを再表示しない根拠にはするが、分析の同意としては扱わない（安全側）。
 * - 保存したら同じタブへイベントで知らせる。他タブの変更は storage イベントで拾う。
 */

export const COOKIE_CONSENT_STORAGE_KEY = 'cookie-consent-v2';
export const LEGACY_COOKIE_CONSENT_STORAGE_KEY = 'cookie-consent';
export const COOKIE_CONSENT_CHANGE_EVENT = 'carelink:cookie-consent-change';

export interface CookiePreferences {
  necessary: true; // 常に true（変更不可）
  analytics: boolean;
  marketing: boolean;
}

/**
 * 保存された選択を読む。未保存・壊れた値・ストレージが使えない環境は null。
 * 各項目は真偽値の true だけを同意として扱う（'true' などの文字列は同意にしない）。
 */
export function readCookiePreferences(): CookiePreferences | null {
  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { analytics, marketing } = parsed as Record<string, unknown>;
    return { necessary: true, analytics: analytics === true, marketing: marketing === true };
  } catch {
    return null;
  }
}

/** 分析 Cookie に同意済みか。旧キー（v1）は見ない。 */
export function hasAnalyticsConsent(): boolean {
  return readCookiePreferences()?.analytics === true;
}

/**
 * バナーに回答済みか（バナーを出さない根拠）。旧キー（v1）も回答済みとして扱う。
 * ストレージが使えない環境では未回答（=バナーを出す）に倒す。
 */
export function hasAnsweredCookieBanner(): boolean {
  try {
    return !!(
      window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY) ||
      window.localStorage.getItem(LEGACY_COOKIE_CONSENT_STORAGE_KEY)
    );
  } catch {
    return false;
  }
}

/**
 * 選択を保存し、同じタブの購読者（計測タグ）へすぐ知らせる。
 * 保存できなかった場合も通知はする（購読側は保存値を読み直すので、同意は有効にならない）。
 */
export function saveCookiePreferences(prefs: CookiePreferences): boolean {
  let saved = false;
  try {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(prefs));
    saved = true;
  } catch {
    // プライベートモード等で書けない。同意は保存されないので計測は始まらない（安全側）。
  }
  window.dispatchEvent(new Event(COOKIE_CONSENT_CHANGE_EVENT));
  return saved;
}

/** useSyncExternalStore 用の購読。同じタブの保存と、他タブでの変更（storage）の両方を拾う。 */
export function subscribeToCookieConsent(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    // key が null になるのは他タブで localStorage.clear() されたとき。
    if (
      event.key === null ||
      event.key === COOKIE_CONSENT_STORAGE_KEY ||
      event.key === LEGACY_COOKIE_CONSENT_STORAGE_KEY
    ) {
      onChange();
    }
  };
  window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(COOKIE_CONSENT_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

// ---------------------------------------------------------------------------
// 計測タグ側の後始末
// ---------------------------------------------------------------------------

/** GA4（_ga, _ga_<測定ID>）と Clarity（_clck, _clsk）が自サイトのドメインに残す Cookie。 */
const ANALYTICS_COOKIE_NAME = /^(?:_ga|_ga_.+|_clck|_clsk)$/;

/**
 * Cookie を消すときに domain 属性として試すドメイン。GA はできるだけ上位のドメイン
 * （例: www.carelink-jp.com で開いても .carelink-jp.com）に付けるため、ホスト限定だけでは消えない。
 * IP アドレスと単一ラベル（localhost）は domain 属性を付けられないので空にする（ホスト限定のみ）。
 */
export function analyticsCookieDomains(hostname: string): string[] {
  if (hostname.startsWith('[') || /^[\d.]+$/.test(hostname) || !hostname.includes('.')) return [];
  const labels = hostname.split('.');
  const domains: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) domains.push(labels.slice(i).join('.'));
  return domains;
}

/** 分析 Cookie を期限切れにする。消した Cookie 名を返す（無ければ空配列）。 */
export function expireAnalyticsCookies(): string[] {
  const names = new Set(
    document.cookie
      .split(';')
      .map((pair) => pair.split('=')[0]!.trim())
      .filter((name) => ANALYTICS_COOKIE_NAME.test(name)),
  );
  const domains = analyticsCookieDomains(window.location.hostname);
  for (const name of names) {
    document.cookie = `${name}=; Max-Age=0; path=/`;
    for (const domain of domains) document.cookie = `${name}=; Max-Age=0; path=/; domain=${domain}`;
  }
  return [...names];
}

type ClarityFunction = ((...args: unknown[]) => void) & { q?: unknown[] };

function currentClarity(): ClarityFunction | undefined {
  const clarity = (window as unknown as { clarity?: unknown }).clarity;
  return typeof clarity === 'function' ? (clarity as ClarityFunction) : undefined;
}

export function clarityTagUrl(clarityId: string): string {
  return `https://www.clarity.ms/tag/${encodeURIComponent(clarityId)}`;
}

/**
 * Microsoft 公式スニペットのキュー用スタブを定義する。
 *
 * 🔴 タグ本体（www.clarity.ms/tag/<id>）は先頭で window.clarity のプロパティを読むため、
 * スタブが無いと TypeError で止まり clarity.js を読み込まない（本番で 1 件も記録されていなかった原因）。
 * タグより先に必ず呼ぶこと。呼び出しはタグ読み込み後に clarity.js がまとめて処理する。
 */
export function ensureClarityStub(): ClarityFunction {
  const existing = currentClarity();
  if (existing) return existing;
  const stub: ClarityFunction = function () {
    // 公式スニペットと同じく arguments をそのまま積む（clarity.js が読む形）。
    // eslint-disable-next-line prefer-rest-params
    (stub.q = stub.q || []).push(arguments);
  };
  (window as unknown as { clarity: ClarityFunction }).clarity = stub;
  return stub;
}

/**
 * 録画してはいけない画面（src/lib/session-recording-scope.ts）へ画面遷移したら Clarity の録画を
 * 止め、録画してよい画面へ戻ったら再開する。返り値は「止めている状態か」（次回の stopped に渡す）。
 *
 * 直接開いた画面ではタグ自体を出さないので、これが要るのは公開ページで読み込んだ後に
 * クライアント遷移で管理画面・マイページ・予約へ移った場合だけ。読み込み前のスタブに積んだ
 * 呼び出しも clarity.js が読み込み時に順に処理する。
 */
export function applySessionRecordingScope(allowed: boolean, stopped: boolean): boolean {
  const clarity = currentClarity();
  if (!clarity) return false;
  if (!allowed) {
    if (!stopped) clarity('stop');
    return true;
  }
  if (stopped) clarity('start');
  return false;
}

/**
 * 同意状態を計測タグへ反映する（AnalyticsGate が同意の変化ごとに呼ぶ）。
 *
 * - 同意あり: GA の送信停止フラグを外し、Clarity にスタブを用意して同意を伝える。
 * - 同意なし: GA の送信を止め（公式のオプトアウト `ga-disable-<測定ID>`）、読み込み済みの
 *   Clarity には同意の撤回を伝え、残っている分析 Cookie を期限切れにする。
 *   以前の版が同意と無関係に付けていた Cookie もここで消える。
 */
export function applyAnalyticsConsent(
  consented: boolean,
  ids: { gaId?: string; clarityId?: string },
): void {
  if (ids.gaId) {
    (window as unknown as Record<string, unknown>)[`ga-disable-${ids.gaId}`] = !consented;
  }
  if (consented) {
    if (ids.clarityId) ensureClarityStub()('consent');
    return;
  }
  currentClarity()?.('consent', false);
  expireAnalyticsCookies();
}
