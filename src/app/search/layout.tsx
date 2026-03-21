import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '施設を探す｜医療・福祉・美容の施設検索',
  description:
    '美容サロン・鍼灸院・整骨院・介護施設・病院を検索。エリア・業種で簡単に探せます。口コミ・メニュー・料金もチェック。',
  alternates: {
    canonical: '/search',
  },
};

export default function SearchLayout({ children }: { children: React.ReactNode }) {
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
              { "@type": "ListItem", position: 2, name: "施設を探す", item: "https://carelink.jp/search" },
            ],
          }),
        }}
      />
      {children}
    </>
  );
}
