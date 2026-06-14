'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface CookiePreferences {
  necessary: true; // 常にtrue（変更不可）
  analytics: boolean;
  marketing: boolean;
}

const STORAGE_KEY = 'cookie-consent-v2';

function getDefaultPrefs(): CookiePreferences {
  return { necessary: true, analytics: false, marketing: false };
}

export function getCookiePreferences(): CookiePreferences | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CookiePreferences;
  } catch {
    return null;
  }
}

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [prefs, setPrefs] = useState<CookiePreferences>(getDefaultPrefs());

  useEffect(() => {
    const consent = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('cookie-consent');
    if (!consent) setVisible(true);
  }, []);

  const save = (p: CookiePreferences) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    setVisible(false);
  };

  const acceptAll = () => save({ necessary: true, analytics: true, marketing: true });
  const declineAll = () => save({ necessary: true, analytics: false, marketing: false });
  const saveCustom = () => save(prefs);

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900/97 backdrop-blur text-white shadow-xl">
      <div className="max-w-4xl mx-auto px-4 pt-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))]">
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
                className="text-sm px-4 py-2 text-gray-300 hover:text-white transition-colors"
              >
                必須のみ
              </button>
              <button
                type="button"
                onClick={acceptAll}
                className="bg-white text-gray-900 font-bold text-sm px-6 py-2 rounded-full hover:bg-gray-100 transition-colors"
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
                  className={`shrink-0 w-10 h-6 rounded-full transition-colors mt-0.5 ${prefs.analytics ? 'bg-sky-500' : 'bg-gray-600'}`}
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
                  className={`shrink-0 w-10 h-6 rounded-full transition-colors mt-0.5 ${prefs.marketing ? 'bg-sky-500' : 'bg-gray-600'}`}
                  aria-label="マーケティングCookieを切り替え"
                >
                  <span className={`block w-4 h-4 bg-white rounded-full transition-transform mx-1 ${prefs.marketing ? 'translate-x-4' : ''}`} />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={() => setShowDetails(false)} className="text-sm text-gray-400 hover:text-white px-3 py-2 transition-colors">
                戻る
              </button>
              <button type="button" onClick={declineAll} className="text-sm px-4 py-2 text-gray-300 hover:text-white transition-colors">
                必須のみ
              </button>
              <button type="button" onClick={saveCustom} className="text-sm px-4 py-2 border border-white/30 rounded-full hover:bg-white/10 transition-colors">
                選択を保存
              </button>
              <button type="button" onClick={acceptAll} className="bg-white text-gray-900 font-bold text-sm px-6 py-2 rounded-full hover:bg-gray-100 transition-colors">
                すべて同意
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
