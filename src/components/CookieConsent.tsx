'use client';

import { useState, useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
// 同意バナー内のポリシーリンク。全ページで初回表示されるので先読みしない
// （理由と実測は components/BrowseLink.tsx）。
import Link from '@/components/BrowseLink';
// 保存・読み取り・変更通知は単一ソース（src/lib/cookie-consent.ts）。計測タグ
// （components/AnalyticsGate.tsx）も同じ判定を使い、ここでの保存にすぐ追従する。
import {
  closeCookieSettings,
  hasAnsweredCookieBanner,
  isCookieSettingsOpen,
  readCookiePreferences,
  saveCookiePreferences,
  subscribeToCookieConsent,
  subscribeToCookieSettings,
  type CookiePreferences,
} from '@/lib/cookie-consent';
import { bottomFixedBarsHeight } from '@/lib/mobile-bottom-bar';

function getDefaultPrefs(): CookiePreferences {
  return { necessary: true, analytics: false, marketing: false };
}

// SSR・初回ハイドレーション時は「同意済み」として扱いバナーを出さない
// （旧実装の初期 state visible=false と同じ見た目）。ハイドレーション後、
// useSyncExternalStore が実値（hasAnsweredCookieBanner）へ自動で切り替える。
function getServerConsentSnapshot(): boolean {
  return true;
}
function getServerSettingsSnapshot(): boolean {
  return false;
}

/**
 * Cookie の同意バナー。
 *
 * 見た目（2026年10月23日）: 以前は画面幅いっぱいの濃いグレーの帯で、スマホでは画面の
 * 3 分の 1 近くを覆っていた。PC では左下の小さなカード、スマホでは下部の固定バー
 * （下部ナビまたは予約バー）1 本の上に乗る小さなシートにした。下部の固定バーは
 * lib/mobile-bottom-bar.ts の目印でいちばん高いものを測って、その上に置く（重ねるのは 1 本まで）。
 * 開き直している間はトップの会員登録 CTA を出さない（StickySignupCta）ので 3 段にはならない。
 *
 * 回答した後もフッターの「Cookie設定」から開き直せる（lib/cookie-consent.ts の openCookieSettings）。
 * 開き直したときは詳細設定を、保存済みの選択を初期値にして開く。
 */
export default function CookieConsent() {
  const [showDetails, setShowDetails] = useState(false);
  const [prefs, setPrefs] = useState<CookiePreferences>(getDefaultPrefs());
  // ユーザーがバナーを閉じた（同意/拒否/選択保存した）かどうか。イベントハンドラからのみ
  // 変更するのでイベント発火の setState であり、React Compiler の set-state-in-effect の
  // 対象外（effect の中では一切セットしない）。
  const [dismissed, setDismissed] = useState(false);
  // 施設詳細の予約バー・スマホの下部ナビ（下部固定バー全般）の高さ分だけ上げる。
  // 重なると「今すぐ予約する」やナビが押せなくなっていた（実機 Playwright で確認）。
  const [bottomOffset, setBottomOffset] = useState(0);

  // 「同意情報が保存されているか」を effect + setState ではなく useSyncExternalStore で
  // レンダー中に読む。他タブで回答した場合も storage イベントで拾い、このタブのバナーも閉じる。
  const hasConsent = useSyncExternalStore(subscribeToCookieConsent, hasAnsweredCookieBanner, getServerConsentSnapshot);
  // フッターの「Cookie設定」から開き直したか
  const reopened = useSyncExternalStore(subscribeToCookieSettings, isCookieSettingsOpen, getServerSettingsSnapshot);
  const firstVisit = !hasConsent && !dismissed;
  const visible = firstVisit || reopened;
  const detailsOpen = showDetails || reopened;

  const headingRef = useRef<HTMLHeadingElement>(null);
  // 開き直す前にフォーカスがあった場所（フッターの「Cookie設定」）。閉じたらそこへ戻す。
  const returnFocusRef = useRef<Element | null>(null);
  const [loadedFor, setLoadedFor] = useState(false);

  // 開き直したら、保存済みの選択を初期値にして見出しへフォーカスを移す。
  // 状態の読み込みは「開いた」という外部イベントへの追従なので、開いた回に 1 度だけ行う。
  if (reopened && !loadedFor) {
    setLoadedFor(true);
    setPrefs(readCookiePreferences() ?? getDefaultPrefs());
  } else if (!reopened && loadedFor) {
    setLoadedFor(false);
  }

  useEffect(() => {
    if (!reopened) return;
    returnFocusRef.current = document.activeElement;
    headingRef.current?.focus();
    return () => {
      const target = returnFocusRef.current;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
      returnFocusRef.current = null;
    };
  }, [reopened]);

  useEffect(() => {
    if (!visible) return;
    const measure = () => setBottomOffset(bottomFixedBarsHeight());
    measure();
    window.addEventListener('resize', measure);
    // 下部ナビは遅延読み込み（ssr:false）で後から現れ、予約バーは残席の表示で高さが変わる。
    // バナーを出している間だけ DOM の変化を見て測り直す。
    const observer = new MutationObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [visible]);

  const save = (p: CookiePreferences) => {
    // 保存と同時に計測タグへ通知する（拒否なら読み込まない・同意ならその場で読み込む・
    // 同意を外したら AnalyticsGate が計測を止めて分析 Cookie を消す）。
    // ストレージが使えない環境（Safari で全 Cookie をブロック等）でも例外を出さず、
    // 選択はこのページ表示の間だけ dismissed で守って閉じる（次の読み込みでは再び尋ねる）。
    saveCookiePreferences(p);
    setDismissed(true);
    setShowDetails(false);
    closeCookieSettings();
  };

  const acceptAll = () => save({ necessary: true, analytics: true, marketing: true });
  const declineAll = () => save({ necessary: true, analytics: false, marketing: false });
  const saveCustom = () => save(prefs);

  if (!visible) return null;

  // 下部バーの上に出すときは、端末下端の余白（safe area）はバー側が取っているので足さない。
  const style = { '--cc-offset': bottomOffset > 0 ? `${bottomOffset}px` : 'env(safe-area-inset-bottom)' } as CSSProperties;
  const ghostButton = 'min-h-[44px] text-sm px-4 py-2 rounded-full border border-gray-300 text-gray-800 hover:bg-gray-50 transition-colors';
  const primaryButton = 'min-h-[44px] text-sm font-bold px-5 py-2 rounded-full bg-primary text-white hover:bg-primary-dark transition-colors';

  return (
    <div
      role="region"
      aria-label="Cookieの設定"
      data-cookie-banner=""
      // 監査対応(実機Playwright確認・第2件): Modal.tsx(z-50)のフッターボタンともz-50同値の
      // 重なりで衝突しクリックできなくなっていた(admin/customersの保存ボタン等)。Modal表示中は
      // 背景オーバーレイの下に隠れるのが自然な挙動のため、z-40に下げてModalより確実に低くする。
      className="fixed z-40 left-2 right-2 bottom-[calc(var(--cc-offset)+0.5rem)] sm:left-4 sm:right-auto sm:w-[24rem] sm:bottom-[calc(var(--cc-offset)+1rem)] max-h-[calc(100dvh-var(--cc-offset)-1.5rem)] overflow-y-auto rounded-2xl border border-gray-200 bg-white text-gray-800 shadow-xl"
      style={style}
    >
      <div className="p-4">
        {!detailsOpen ? (
          /* 簡易表示 */
          <div>
            <p className="text-[13px] leading-relaxed text-gray-700">
              当サイトではサービス向上のためCookieを使用しています。分析Cookieは同意いただいた場合だけ使用します（
              <Link href="/privacy" className="underline text-primary hover:text-primary-dark">
                プライバシーポリシー
              </Link>
              ）。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setShowDetails(true)} className="min-h-[44px] mr-auto text-[13px] text-gray-700 underline hover:text-gray-900">
                設定を変更
              </button>
              <button type="button" onClick={declineAll} className={ghostButton}>
                必須のみ
              </button>
              <button type="button" onClick={acceptAll} className={primaryButton}>
                すべて同意
              </button>
            </div>
          </div>
        ) : (
          /* 詳細設定パネル */
          <div>
            <h3 ref={headingRef} tabIndex={-1} className="font-bold text-base mb-3 outline-none">Cookie設定</h3>
            <div className="space-y-2 mb-4">
              {/* 必須 */}
              <div className="flex items-start justify-between gap-4 p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium">必須Cookie</p>
                  <p className="text-xs text-gray-600 mt-0.5">ログイン・セキュリティなど、サービスの基本機能に必要です。無効にできません。</p>
                </div>
                <div className="text-xs text-gray-600 shrink-0 mt-0.5">常に有効</div>
              </div>

              {/* 分析 */}
              <div className="flex items-start justify-between gap-4 p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium">分析Cookie</p>
                  {/* 実際の読み込み範囲（Clarity は公開ページだけ）は src/lib/session-recording-scope.ts。
                      ここを変えるときはプライバシーポリシー第8条も合わせる。 */}
                  <p className="text-xs text-gray-600 mt-0.5">ページビューや利用状況の把握（Google Analytics）と、画面操作の分析（Microsoft Clarity のヒートマップ・セッション録画）に使用します。ログイン・マイページ・予約・問診・管理画面など、お客様の情報を表示する画面では録画しません。</p>
                </div>
                {/* 状態は色とつまみの位置だけでなく role="switch"＋aria-checked で読み上げる（名前に状態を含めない）。
                    つまみの地色は白地に対して 3:1 以上（OFF gray-500 4.8:1 ／ ON sky-700 5.9:1）。 */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.analytics}
                  onClick={() => setPrefs((p) => ({ ...p, analytics: !p.analytics }))}
                  className={`relative shrink-0 w-10 h-6 rounded-full transition-colors mt-0.5 before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] ${prefs.analytics ? 'bg-sky-700' : 'bg-gray-500'}`}
                  aria-label="分析Cookie"
                >
                  <span className={`block w-4 h-4 bg-white rounded-full transition-transform mx-1 ${prefs.analytics ? 'translate-x-4' : ''}`} />
                </button>
              </div>

              {/* マーケティング */}
              <div className="flex items-start justify-between gap-4 p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium">マーケティングCookie</p>
                  <p className="text-xs text-gray-600 mt-0.5">お客様の興味に合わせた情報をお届けするために使用します。</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.marketing}
                  onClick={() => setPrefs((p) => ({ ...p, marketing: !p.marketing }))}
                  className={`relative shrink-0 w-10 h-6 rounded-full transition-colors mt-0.5 before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] ${prefs.marketing ? 'bg-sky-700' : 'bg-gray-500'}`}
                  aria-label="マーケティングCookie"
                >
                  <span className={`block w-4 h-4 bg-white rounded-full transition-transform mx-1 ${prefs.marketing ? 'translate-x-4' : ''}`} />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              {reopened ? (
                <button type="button" onClick={closeCookieSettings} className="min-h-[44px] text-sm text-gray-700 hover:text-gray-900 px-3 py-2 mr-auto transition-colors">
                  閉じる
                </button>
              ) : (
                <button type="button" onClick={() => setShowDetails(false)} className="min-h-[44px] text-sm text-gray-700 hover:text-gray-900 px-3 py-2 mr-auto transition-colors">
                  戻る
                </button>
              )}
              <button type="button" onClick={declineAll} className={ghostButton}>
                必須のみ
              </button>
              <button type="button" onClick={saveCustom} className={ghostButton}>
                選択を保存
              </button>
              <button type="button" onClick={acceptAll} className={primaryButton}>
                すべて同意
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
