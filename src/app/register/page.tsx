import type { Metadata } from 'next';
import '@fontsource-variable/noto-serif-jp/index.css';
import RegisterLanding from '@/components/register/RegisterLanding';
import { getAvailableAreasAndTypes } from '@/lib/facilities';

export const dynamic = 'force-dynamic';

const TITLE = '店舗・施設の掲載登録';
const DESCRIPTION =
  '店舗・施設の掲載料と予約手数料は無料。掲載条件と準備内容を確認して、CareLinkへの登録を始められます。';

/**
 * /register の metadata はここが単一ソース（以前は layout.tsx と page.tsx が別々の title・description を
 * 持ち、どちらが出るかを読まないと分からなかった）。
 *
 * - title: ルート layout の title.template '%s | CareLink' が付くので「| CareLink」は書かない
 *   （書くと「… | CareLink | CareLink」と二重になる。src/__tests__/metadata-title-template.test.ts）。
 * - 共有画像: 同じフォルダの opengraph-image.png / twitter-image.png（Next.js のファイル規約）。
 *   くすみ系の地色に「掲載料・予約手数料0円」。scripts/gen-register-og-image.mjs で生成する。
 *   ここで images を指定しない（ファイル規約が優先され、二重に書くと食い違うため）。
 * - openGraph.title / twitter.title はテンプレートが効かないのでフルタイトルを書く。
 */
export const metadata: Metadata = {
  // 静的に読める文字列で書く（metadata-title-template.test.ts が TypeScript の構文木から読む）。
  title: '店舗・施設の掲載登録',
  description: DESCRIPTION,
  alternates: { canonical: '/register' },
  openGraph: {
    type: 'website',
    title: `${TITLE} | CareLink`,
    description: DESCRIPTION,
    url: '/register',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${TITLE} | CareLink`,
    description: DESCRIPTION,
  },
};

/**
 * 施設向けの掲載登録ページ。描画は RegisterLanding（訴求＋フォーム）。
 * ここでは「現在の主な掲載エリア」を DB の実在値から取るだけ。
 *
 * 取得に失敗しても（Supabase の公開キーを持たない Vercel Preview を含む）ページは出す。
 * エリア表示が消えるだけで、申し込みフォームは使える状態を保つ。
 */
export default async function RegisterPage() {
  const listingAreas = await getAvailableAreasAndTypes()
    .then((r) => r.areas)
    .catch(() => [] as string[]);
  return <RegisterLanding listingAreas={listingAreas} />;
}
