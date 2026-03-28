import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '【無料掲載】医療・福祉・美容の集客サイト',
  description:
    '美容サロン・鍼灸院・整骨院・介護施設の集客に。掲載無料・登録3分ですぐに集客を開始できます。業界特化で効率的にお客様を獲得。',
  alternates: {
    canonical: '/salon',
  },
  openGraph: {
    title: '【無料掲載】医療・福祉・美容の集客サイト | CareLink',
    description: '掲載無料・登録3分・業界特化で効率的に集客',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
};

export default function SalonLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "トップ", item: "https://www.carelink-jp.com" },
              { "@type": "ListItem", position: 2, name: "施設・サロンの方", item: "https://www.carelink-jp.com/salon" },
            ],
          }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
        }}
      />
      {children}
    </>
  );
}
