'use client';
import dynamic from 'next/dynamic';

// ssr:false を外し SSR を有効化（scale監査 #2）。HomeBelowFold は全47都道府県・業種×エリアの
// 内部リンクハブを含むが、ssr:false だと配信HTMLから消え Googlebot にリンク資産が伝わらなかった。
// トップレベルでブラウザAPIを使わず、client 専用widget(HomeUserPanel/JapanRegionMap)は内部で
// 個別に ssr:false 化済みのため、本コンポーネント自体は安全に SSR できる。code-split は維持。
export const HomeBelowFold = dynamic(() => import('./HomeBelowFold'), {
  loading: () => <div className="h-96 bg-gray-50" />,
});

export const StickySignupCta = dynamic(() => import('./StickySignupCta'), {
  ssr: false,
});
