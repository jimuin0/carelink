import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '施設登録（無料）',
  description: '美容サロン・鍼灸院・整骨院・介護施設・クリニックの施設情報を無料で登録。3分で掲載開始、ネット予約・口コミで集客を強化できます。',
  alternates: {
    canonical: '/recruit',
  },
  openGraph: {
    title: '施設を無料で掲載 | CareLink',
    description: '掲載料無料。ネット予約・口コミで集客を強化できます。',
    type: 'website',
  },
};

export default function RecruitLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
