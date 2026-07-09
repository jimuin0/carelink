import type { Metadata } from 'next';

export const metadata: Metadata = {
  // ルート layout の title.template '%s | CareLink' が自動付与するため「| CareLink」は付けない（二重化防止）。
  // openGraph.title はテンプレ非適用のためフルタイトルのまま維持する。
  title: '無料掲載登録',
  description: '医療・福祉・美容施設の掲載を無料で登録できます。最短3分で入力完了、そのままアカウントを作成して掲載を開始できます。',
  alternates: { canonical: '/register' },
  openGraph: {
    title: '無料掲載登録 | CareLink',
    description: '医療・福祉・美容施設の掲載を無料で登録。最短3分で入力完了。',
  },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
