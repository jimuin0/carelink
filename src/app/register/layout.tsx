import type { Metadata } from 'next';

export const metadata: Metadata = {
  // ルート layout の title.template '%s | CareLink' が自動付与するため「| CareLink」は付けない（二重化防止）。
  // openGraph.title はテンプレ非適用のためフルタイトルのまま維持する。
  title: '施設の掲載登録',
  description: '医療・福祉・美容施設の掲載条件と準備内容を確認して、CareLinkへの登録を始められます。',
  alternates: { canonical: '/register' },
  openGraph: {
    title: '施設の掲載登録 | CareLink',
    description: '医療・福祉・美容施設の掲載条件と準備内容を確認できます。',
  },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
