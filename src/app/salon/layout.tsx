import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '【無料掲載】医療・福祉・美容の集客サイト',
  description:
    '美容サロン・鍼灸院・整骨院・介護施設の集客に。掲載無料・登録3分ですぐに集客を開始できます。AI自動マッチングで効率的にお客様を獲得。',
  openGraph: {
    title: '【無料掲載】医療・福祉・美容の集客サイト | CareLink',
    description: '掲載無料・登録3分・AI自動マッチングで効率的に集客',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
};

export default function SalonLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
