import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import "./globals.css";

const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL('https://carelink.jp'),
  title: {
    default: "CareLink | 医療・福祉・美容の採用×集客プラットフォーム",
    template: "%s | CareLink",
  },
  description:
    "医療・福祉・美容に特化した採用×集客プラットフォーム。サロン・施設の集客と求職者の転職をサポートします。",
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: "CareLink",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  const clarityId = process.env.NEXT_PUBLIC_CLARITY_ID;

  return (
    <html lang="ja">
      <body className={`${notoSansJP.className} antialiased min-h-screen flex flex-col`}>
        {gaId && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
              strategy="afterInteractive"
            />
            <Script id="ga4" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');`}
            </Script>
          </>
        )}
        {clarityId && (
          <Script id="clarity" strategy="afterInteractive">
            {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${clarityId}");`}
          </Script>
        )}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              {
                "@context": "https://schema.org",
                "@type": "WebSite",
                name: "CareLink",
                url: "https://carelink.jp",
                description: "医療・福祉・美容に特化した採用×集客プラットフォーム",
                publisher: {
                  "@type": "Organization",
                  name: "CareLink",
                  url: "https://carelink.jp",
                },
              },
              {
                "@context": "https://schema.org",
                "@type": "LocalBusiness",
                name: "CareLink（神原良祐 / HALグループ）",
                description: "医療・福祉・美容に特化した採用×集客プラットフォーム",
                url: "https://carelink.jp",
                address: {
                  "@type": "PostalAddress",
                  addressLocality: "堺市",
                  addressRegion: "大阪府",
                  addressCountry: "JP",
                },
                priceRange: "無料",
              },
              {
                "@context": "https://schema.org",
                "@type": "FAQPage",
                mainEntity: [
                  {
                    "@type": "Question",
                    name: "本当に無料ですか？",
                    acceptedAnswer: {
                      "@type": "Answer",
                      text: "はい、施設の掲載も求職者の登録も完全無料です。初期費用・月額費用は一切かかりません。",
                    },
                  },
                  {
                    "@type": "Question",
                    name: "どんな業種が対象ですか？",
                    acceptedAnswer: {
                      "@type": "Answer",
                      text: "美容サロン・アイラッシュ、鍼灸院、整骨院、介護施設・デイサービス、病院・クリニックなど、医療・福祉・美容業界に幅広く対応しています。",
                    },
                  },
                  {
                    "@type": "Question",
                    name: "登録後、すぐに利用開始できますか？",
                    acceptedAnswer: {
                      "@type": "Answer",
                      text: "登録後、2営業日以内に担当者よりご連絡いたします。内容を確認させていただいた後、すぐにサービスをご利用いただけます。",
                    },
                  },
                  {
                    "@type": "Question",
                    name: "途中で退会できますか？",
                    acceptedAnswer: {
                      "@type": "Answer",
                      text: "いつでも退会可能です。退会後はすべてのデータを削除いたします。違約金等は一切かかりません。",
                    },
                  },
                ],
              },
            ]),
          }}
        />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
