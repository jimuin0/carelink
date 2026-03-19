import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '医療・福祉・美容の転職サイト',
  description:
    '介護士・鍼灸師・アイリスト・看護師の転職に特化。完全無料で登録、あなたに合った求人がLINEで届きます。',
  openGraph: {
    title: '医療・福祉・美容の転職サイト | CareLink',
    description: '完全無料・登録3分。あなたのスキルを正しく評価してくれる職場へ。',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
};

export default function JobsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
