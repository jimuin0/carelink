'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';
// 同意バナー内のポリシーリンク。全ページで初回表示されるので先読みしない
// （理由と実測は components/BrowseLink.tsx）。
import Link from '@/components/BrowseLink';
// 保存・読み取り・変更通知は単一ソース（src/lib/cookie-consent.ts）。計測タグ
// （components/AnalyticsGate.tsx）も同じ判定を使い、ここでの保存にすぐ追従する。
import {
  hasAnsweredCookieBanner,
  saveCookiePreferences,
  subscribeToCookieConsent,
  type CookiePreferences,
} from '@/lib/cookie-consent';

function getDefaultPrefs(): CookiePreferences {
  return { necessary: true, analytics: false, marketing: false };
}

// SSR・初回ハイドレーション時は「同意済み」として扱いバナーを出さない
// （旧実装の初期 state visible=false と同じ見た目）。ハイドレーション後、
// useSyncExternalStore が実値（hasAnsweredCookieBanner）へ自動で切り替える。
function getServerConsentSnapshot(): boolean {
  return true;
}

export default function CookieConsent() {
  const [showDetails, setShowDetails] = useState(false);
  const [prefs, setPrefs] = useState<CookiePreferences>(getDefaultPrefs());
  // ユーザーがバナーを閉じた（同意/拒否/選択保存した）かどうか。イベントハンドラからのみ
  // 変更するのでイベント発火の setState であり、React Compiler の set-state-in-effect の
  // 対象外（effect の中では一切セットしない）。
  const [dismissed, setDismissed] = useState(false);
  // 施設詳細ページのSticky予約バー(.sticky-bar、fixed bottom-0 z-40)と本バナー(fixed bottom-0
  // z-50)が両方画面下部に固定表示されるため、本バナーが「今すぐ予約する」ボタンの前面に重なり
  // クリックできなくなっていた（実機Playwright確認で発見）。sticky-barの高さ分だけ上にオフセットする。
  const [bottomOffset, setBottomOffset] = useState(0);

  // 「同意情報が保存されているか」を effect + setState ではなく useSyncExternalStore で
  // レンダー中に読む。ブラウザ専用 API を安全に扱いつつハイドレーション不整合も出さない
  // React 標準パターンへの構造変更（symptom を隠すラッパーではなく、setState をそもそも
  // effect の外へ追い出す本質的な修正）。
  // 他タブで回答した場合も storage イベントで拾い、このタブのバナーも閉じる。
  const hasConsent = useSyncExternalStore(subscribeToCookieConsent, hasAnsweredCookieBanner, getServerConsentSnapshot);
  const visible = !hasConsent && !dismissed;

  useEffect(() => {
    if (!visible) return;
    const measure = () => {
      const bar = document.querySelector('.sticky-bar');
      setBottomOffset(bar ? bar.getBoundingClientRect().height : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [visible]);

  const save = (p: CookiePreferences) => {
    // 保存と同時に計測タグへ通知する（拒否なら読み込まない・同意ならその場で読み込む）。
    saveCookiePreferences(p);
    setDismissed(true);
  };

  const acceptAll = () => save({ necessary: true, analytics: true, marketing: true });
  const declineAll = () => save({ necessary: true, analytics: false, marketing: false });
  const saveCustom = () => save(prefs);

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Cookieの設定"
      // 監査対応(実機Playwright確認・第2件): Modal.tsx(z-50)のフッターボタンともz-50同値の
      // 重なりで衝突しクリックできなくなっていた(admin/customersの保存ボタン等)。Modal表示中は
      // 背景オーバーレイの下に隠れるのが自然な挙動のため、z-40に下げてModalより確実に低くする。
      className="fixed bottom-0 left-0 right-0 z-40 bg-gray-900 backdrop-blur-sm text-white shadow-xl"
      style={bottomOffset > 0 ? { bottom: bottomOffset } : undefined}
    >
      <div className="max-w-4xl mx-auto px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {!showDetails ? (
          /* シンプルバー */
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-6">
            <p className="text-sm text-gray-200 flex-1">
              当サイトではサービス向上のためCookieを使用しています。
              <button type="button" onClick={() => setShowDetails(true)} className="underline text-blue-300 hover:text-blue-200 mx-1">
                設定を変更
              </button>
              または
              <Link href="/privacy" className="underline text-blue-300 hover:text-blue-200 mx-1">
                プライバシーポリシー
              </Link>
              をご覧ください。
            </p>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={declineAll}
                className="min-h-[44px] text-sm px-4 py-2 text-gray-300 hover:text-white transition-colors"
              >
                必須のみ
              </button>
              <button
                type="button"
                onClick={acceptAll}
                className="min-h-[44px] bg-white text-gray-900 font-bold text-sm px-6 py-2 rounded-full hover:bg-gray-100 transition-colors"
              >
                すべて同意
              </button>
            </div>
          </div>
        ) : (
          /* 詳細設定パネル */
          <div>
            <h3 className="font-bold text-base mb-3">Cookie設定</h3>
            <div className="space-y-3 mb-4">
              {/* 必須 */}
              <div className="flex items-start justify-between gap-4 p-3 bg-white/5 rounded-lg">
                <div>
                  <p className="text-sm font-medium">必須Cookie</p>
                  <p className="text-xs text-gray-400 mt-0.5">ログイン・セキュリティなど、サービスの基本機能に必要です。無効にできません。</p>
                </div>
                <div className="text-xs text-gray-400 shrink-0 mt-0.5">常に有効</div>
              </div>

              {/* 分析 */}
              <div className="flex items-start justify-between gap-4 p-3 bg-white/5 rounded-lg">
                <div>
                  <p className="text-sm font-medium">分析Cookie</p>
                  <p className="text-xs text-gray-400 mt-0.5">ページビューや利用状況の把握に使用します。個人を特定するデータは収集しません。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPrefs((p) => ({ ...p, analytics: !p.analytics }))}
                  className={`relative shrink-0 w-10 h-6 rounded-full transition-colors mt-0.5 before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] ${prefs.analytics ? 'bg-sky-500' : 'bg-gray-600'}`}
                  aria-label="分析Cookieを切り替え"
                >
                  <span className={`block w-4 h-4 bg-white rounded-full transition-transform mx-1 ${prefs.analytics ? 'translate-x-4' : ''}`} />
                </button>
              </div>

              {/* マーケティング */}
              <div className="flex items-start justify-between gap-4 p-3 bg-white/5 rounded-lg">
                <div>
                  <p className="text-sm font-medium">マーケティングCookie</p>
                  <p className="text-xs text-gray-400 mt-0.5">お客様の興味に合わせた情報をお届けするために使用します。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPrefs((p) => ({ ...p, marketing: !p.marketing }))}
                  className={`relative shrink-0 w-10 h-6 rounded-full transition-colors mt-0.5 before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] ${prefs.marketing ? 'bg-sky-500' : 'bg-gray-600'}`}
                  aria-label="マーケティングCookieを切り替え"
                >
                  <span className={`block w-4 h-4 bg-white rounded-full transition-transform mx-1 ${prefs.marketing ? 'translate-x-4' : ''}`} />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={() => setShowDetails(false)} className="min-h-[44px] text-sm text-gray-400 hover:text-white px-3 py-2 transition-colors">
                戻る
              </button>
              <button type="button" onClick={declineAll} className="min-h-[44px] text-sm px-4 py-2 text-gray-300 hover:text-white transition-colors">
                必須のみ
              </button>
              <button type="button" onClick={saveCustom} className="min-h-[44px] text-sm px-4 py-2 border border-white/30 rounded-full hover:bg-white/10 transition-colors">
                選択を保存
              </button>
              <button type="button" onClick={acceptAll} className="min-h-[44px] bg-white text-gray-900 font-bold text-sm px-6 py-2 rounded-full hover:bg-gray-100 transition-colors">
                すべて同意
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
