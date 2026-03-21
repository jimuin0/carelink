import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '【無料掲載】医療・福祉・美容の採用サイト',
  description:
    '採用コスト0円・登録3分で求人掲載を開始。医療・福祉・美容業界に特化した採用プラットフォームで、優秀なスタッフを採用。',
  alternates: {
    canonical: '/recruit',
  },
  openGraph: {
    title: '【無料掲載】医療・福祉・美容の採用サイト | CareLink',
    description: '採用コスト0円・登録3分・業界特化で優秀なスタッフを採用',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
};

export default function RecruitLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "トップ", item: "https://carelink.jp" },
              { "@type": "ListItem", position: 2, name: "採用したい方", item: "https://carelink.jp/recruit" },
            ],
          }),
        }}
      />
      {children}
    </>
  );
}
