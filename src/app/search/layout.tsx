import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'サロン・クリニック検索｜美容・医療・福祉',
  description:
    '美容サロン・鍼灸院・整骨院・介護施設・病院を検索。エリア・業種で簡単に探せます。メニュー・料金・口コミもチェック。',
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
              { "@type": "ListItem", position: 2, name: "サロン・クリニック検索", item: "https://carelink.jp/search" },
            ],
          }),
        }}
      />
      {children}
    </>
  );
}
