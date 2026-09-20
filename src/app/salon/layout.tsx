import type { Metadata } from 'next';
import { safeJsonLd } from '@/lib/json-ld';

export const metadata: Metadata = {
  title: '【無料掲載】医療・福祉・美容の集客サイト',
  description:
    '美容サロン・鍼灸院・整骨院・介護施設の集客に。掲載料・予約手数料の現在条件と、登録後に準備する内容を確認できます。',
  alternates: {
    canonical: '/salon',
  },
  openGraph: {
    title: '【無料掲載】医療・福祉・美容の集客サイト | CareLink',
    description: '掲載料・予約手数料の現在条件と、施設向けの登録・掲載準備を案内します。',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
};

export default function SalonLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLd({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "トップ", item: "https://carelink-jp.com" },
              { "@type": "ListItem", position: 2, name: "施設・サロンの方", item: "https://carelink-jp.com/salon" },
            ],
          }),
        }}
      />
      {children}
    </>
  );
}
