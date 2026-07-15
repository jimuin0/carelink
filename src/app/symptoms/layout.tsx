import type { Metadata } from 'next';

// symptoms/page.tsx は 'use client' のため、この layout.tsx（サーバーコンポーネント）で
// 固有の metadata を定義する。ルート layout の title.template '%s | CareLink' が自動付与するため
// title に「| CareLink」は付けない（付けると二重化する）。openGraph.title はテンプレ非適用のため
// 明示的にフル文字列を設定する。
export const metadata: Metadata = {
  title: 'AI症状チェッカー',
  description: 'お悩みの症状を入力すると、AIが適切な治療法と近くの施設を提案します。肩こり・腰痛・頭痛など、気になる症状を自由に入力して分析できます。',
  alternates: { canonical: '/symptoms' },
  openGraph: {
    title: 'AI症状チェッカー | CareLink',
    description: 'お悩みの症状を入力すると、AIが適切な治療法と近くの施設を提案します',
    type: 'website',
  },
};

export default function SymptomsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
