'use client';

import { openCookieSettings } from '@/lib/cookie-consent';

/**
 * フッターの「Cookie設定」。同意バナーに回答した後でも、ここから設定を開き直して
 * 分析 Cookie の同意を取り消せる（2026年10月23日。以前は開き直す手段が画面上に無かった）。
 * 押すとバナー（components/CookieConsent.tsx）が詳細設定の状態で開く。
 *
 * 押せる範囲は呼び出し側に任せず、ここで最低 24px 四方を確保する（WCAG 2.5.8 AA）。
 * フッターの flex の中に置かれた button は block 扱いになり「文章中の inline の例外」に
 * 当たらないため、11〜14px の文字の高さだけでは小さすぎる（e2e/accessibility.spec.ts の
 * タップターゲット検査が実際に検知した）。button は中身を縦方向の中央に置くので、
 * min-height を足しても文字の位置は崩れない。並びの他のリンクと揃えるため 44px までは広げない。
 */
export default function CookieSettingsButton({ className = '' }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openCookieSettings}
      className={['min-h-6 min-w-6', className].filter(Boolean).join(' ')}
    >
      Cookie設定
    </button>
  );
}
