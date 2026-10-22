import type { Metadata } from 'next';
import { getSymptomSlugsWithPublishedFacilities } from '@/lib/symptom-coverage';

// symptom-checker/page.tsx は 'use client' のため、この layout.tsx（サーバーコンポーネント）で
// 固有の metadata を定義する。ルート layout の title.template '%s | CareLink' が自動付与するため
// title に「| CareLink」は付けない（付けると二重化する）。openGraph.title はテンプレ非適用のため
// 明示的にフル文字列を設定する。
const BASE_METADATA: Metadata = {
  title: '症状チェッカー',
  description: 'お悩みの症状を選択すると、対応できる店舗が見つかります。頭痛・肩こり・腰痛など部位別に症状を選んで、対応可能な施設をすぐに検索できます。',
  alternates: { canonical: '/symptom-checker' },
  openGraph: {
    title: '症状チェッカー | CareLink',
    description: 'お悩みの症状を選択すると、対応できる店舗が見つかります',
    type: 'website',
  },
};

/**
 * 選べる症状のどれにも公開施設が無い間は、どの症状を選んでも「0件」しか返せない。
 * その間は検索結果に出さない（2026年10月22日・神原さん決定「施設が載るまで検索に出さない」）。
 * sitemap も同じ条件で外している（src/app/sitemap.ts）。読み取りに失敗したら例外にし、
 * 「施設なし」と取り違えて index の可否を決めない。
 */
export async function generateMetadata(): Promise<Metadata> {
  const covered = await getSymptomSlugsWithPublishedFacilities();
  return {
    ...BASE_METADATA,
    ...(covered.size === 0 ? { robots: { index: false, follow: true } } : {}),
  };
}

export default function SymptomCheckerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
