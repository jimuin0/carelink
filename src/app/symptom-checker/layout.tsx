import type { Metadata } from 'next';

// symptom-checker/page.tsx は 'use client' のため、この layout.tsx（サーバーコンポーネント）で
// 固有の metadata を定義する。ルート layout の title.template '%s | CareLink' が自動付与するため
// title に「| CareLink」は付けない（付けると二重化する）。openGraph.title はテンプレ非適用のため
// 明示的にフル文字列を設定する。
export const metadata: Metadata = {
  title: '症状チェッカー',
  description: 'お悩みの症状を選択すると、対応できる店舗が見つかります。頭痛・肩こり・腰痛など部位別に症状を選んで、対応可能な施設をすぐに検索できます。',
  alternates: { canonical: '/symptom-checker' },
  openGraph: {
    title: '症状チェッカー | CareLink',
    description: 'お悩みの症状を選択すると、対応できる店舗が見つかります',
    type: 'website',
  },
};

export default function SymptomCheckerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
