'use client';

import { openCookieSettings } from '@/lib/cookie-consent';

/**
 * フッターの「Cookie設定」。同意バナーに回答した後でも、ここから設定を開き直して
 * 分析 Cookie の同意を取り消せる（2026年10月23日。以前は開き直す手段が画面上に無かった）。
 * 押すとバナー（components/CookieConsent.tsx）が詳細設定の状態で開く。
 */
export default function CookieSettingsButton({ className = '' }: { className?: string }) {
  return (
    <button type="button" onClick={openCookieSettings} className={className}>
      Cookie設定
    </button>
  );
}
