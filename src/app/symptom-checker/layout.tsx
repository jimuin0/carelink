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

/**
 * metadata と同じ読み取りを layout 本体でも待つ（同じリクエスト内では cache で 1 回にまとまる）。
 *
 * Next 16 の metadata は本文とは別に（Suspense の中で）描画される。page は 'use client' で
 * サーバー側の読み取りはこの 1 本だけなので、metadata だけで読むと、失敗したとき本文が 200 で返り
 * title・canonical・robots が 1 つも出ない（＝障害中のページが index 可になる）。
 * 本体でも待てば、失敗は描画ツリーから例外になり error.tsx（5xx）になる。
 */
export default async function SymptomCheckerLayout({ children }: { children: React.ReactNode }) {
  await getSymptomSlugsWithPublishedFacilities();
  return <>{children}</>;
}
