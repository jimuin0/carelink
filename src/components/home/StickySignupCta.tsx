'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Button from '@/components/ui/Button';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { hasAnsweredCookieBanner, isCookieSettingsOpen, subscribeToCookieConsent, subscribeToCookieSettings } from '@/lib/cookie-consent';

// 描画は ssr:false（DynamicHomeSections）だが、念のためサーバー値は「未同意＝出さない」に倒す。
function getServerConsentSnapshot(): boolean {
  return false;
}
function getServerSettingsSnapshot(): boolean {
  return false;
}

/**
 * トップのスマホ向け会員登録 CTA。
 *
 * 2026年10月22日: 以前は fixed bottom-0 z-50 で、下部ナビ・Cookie 同意バナーの
 * 「必須のみ／すべて同意」・フッターの利用規約／特商法表記をまとめて覆っていた（本番・iPhone 13 で実測）。
 * - 同意バナーが出ている間は出さない（同意の選択が保存された時点で出す）。
 * - 下部ナビ（--mobile-nav-height）のすぐ上に出す。
 * - fixed ではなく sticky にする。ページ末尾では本来の位置（フッターの直前）に収まるので、
 *   フッターのリンクを覆わない。
 * - 2026年10月23日: フッターの「Cookie設定」から同意バナーを開き直している間も出さない
 *   （下部ナビ・CTA・バナーの 3 段が重なってボタンを覆うため）。
 */
export default function StickySignupCta() {
  const [show, setShow] = useState(false);
  const consentStored = useSyncExternalStore(subscribeToCookieConsent, hasAnsweredCookieBanner, getServerConsentSnapshot);
  const cookieSettingsOpen = useSyncExternalStore(subscribeToCookieSettings, isCookieSettingsOpen, getServerSettingsSnapshot);

  useEffect(() => {
    if (sessionStorage.getItem('sticky-cta-dismissed')) return;
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) setShow(true);
    }).catch(() => {});
  }, []);

  if (!show || !consentStored || cookieSettingsOpen) return null;

  return (
    <div
      data-sticky-signup-cta=""
      className="sticky bottom-[var(--mobile-nav-height)] z-30 sm:hidden bg-white border-t border-gray-200 shadow-[0_-2px_12px_rgba(0,0,0,0.08)] px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 mb-1.5">予約のたびにポイント還元。利用は完全無料。</p>
          {/* 登録 CTA は高意図の導線なので従来どおり先読みさせる（components/BrowseLink.tsx）。 */}
          <Button href="/auth/signup" prefetch="auto" fullWidth>
            無料で会員登録する
          </Button>
        </div>
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem('sticky-cta-dismissed', '1');
            setShow(false);
          }}
          className="shrink-0 w-11 h-11 flex items-center justify-center text-gray-500 hover:text-gray-600 text-lg"
          aria-label="閉じる"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
