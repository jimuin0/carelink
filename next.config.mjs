/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Scale-to-zero containers should load the requested route, not every page
  // and API on each cold start. Bytecode is still prepared at image build time.
  experimental: { preloadEntriesOnStart: false },
  outputFileTracingIncludes: {
    '/api/og': [
      './node_modules/@resvg/resvg-wasm/index_bg.wasm',
      './node_modules/@fontsource-variable/noto-sans-jp/wght.css',
      './node_modules/@fontsource-variable/noto-sans-jp/files/*.woff2',
    ],
  },
  images: {
    // Container instances do their own image encoding. Prefer Next's default
    // WebP format to avoid repeated, CPU-heavy AVIF encodes after cold starts.
    formats: ['image/webp'],
    // 🔴 ここに外部ホストを足さないこと。remotePatterns に載ったホストは
    // 「任意の画像を next/image 経由で表示できるドメイン」になる。
    //
    // 【経緯】初期シード(scripts/seed-facilities.mjs・migrations 20260321000004/20260331000001)が
    // デモ施設の写真に Unsplash URL を使っていたため images.unsplash.com を許可していた
    // （未許可だと /search・/ranking で next/image が 400 を返し画像が壊れる。2026年7月5日に実機確認）。
    // 2026年8月12日、本番の全画像列24本を棚卸しして【ストック写真が1件も残っていない】ことを
    // 確認したうえで撤去した。新規保存は src/lib/stock-image-guard.ts が入口で拒否している。
    remotePatterns: [
      { protocol: 'https', hostname: 'xzafxiupbflvgbarrihe.supabase.co' },
    ],
  },
  async redirects() {
    // 店舗向けの入口は /register の 1 本だけ（2026年10月23日 神原さん決定）。
    // 旧 LP（/salon）と、その配下で「運営者の紹介」「管理画面の機能一覧」を出していた
    // /salon/cases・/salon/demo は /register へ恒久転送する（308）。外部に貼られた旧リンク・
    // 営業資料・検索結果からの流入を落とさないため、ページを消すだけにはしない。
    // /salon/premium は有料プランの温存ページで、現在は notFound()（LAUNCH_HIDDEN）。転送しない。
    // /recruit は「施設登録（無料）」の別フォーム（同じ /api/salons へ送る簡易版）だった。店舗の登録入口を
    // /register に一本化したので、フォームを撤去して /register へ恒久転送する（2026年10月23日 神原さん決定）。
    // src/__tests__/shop-landing-unification.test.ts が転送と内部リンクの張り替えを固定する。
    return [
      { source: '/salon', destination: '/register', permanent: true },
      { source: '/salon/cases', destination: '/register', permanent: true },
      { source: '/salon/demo', destination: '/register', permanent: true },
      { source: '/recruit', destination: '/register', permanent: true },
    ];
  },
  async headers() {
    // ページ(HTML)の CSP は src/middleware.ts が per-request nonce ベースで付与する
    // （Next.js が出力する script に nonce を適用し 'unsafe-inline' を script から排除するため）。
    // ここでは middleware が対象外とする /api/* 向けの静的 CSP と、全ルート共通の
    // 非 CSP セキュリティヘッダのみを定義する（ページに静的 CSP を出すと middleware の
    // nonce CSP と二重化して衝突するため、ページには CSP を出さない）。
    return [
      // Fixed repository assets contain no session or facility data. Container
      // public files otherwise return max-age=0, invoking Node on every miss.
      // Cache only these exact paths at Vercel; browsers still revalidate and
      // service-worker scripts, HTML, APIs and uploaded images remain excluded.
      ...[
        '/favicon.svg', '/apple-touch-icon.png', '/og-image.png', '/manifest.json',
        '/icons/icon-192.png', '/icons/icon-192.svg', '/icons/icon-512.png', '/icons/icon-512.svg',
        '/images/banner-eyelash.webp', '/images/banner-relax.webp', '/images/banner-hair.webp',
        '/images/hero-tiny.webp', '/images/hero.webp', '/images/hero-640.webp', '/images/hero-1200.webp',
        '/images/cta.webp', '/images/leaflet/leaflet.css', '/images/leaflet/marker-shadow.png',
        '/images/leaflet/marker-icon-2x.png', '/images/leaflet/marker-icon.png',
      ].map((source) => ({
        source,
        headers: [{ key: 'Vercel-CDN-Cache-Control', value: 'public, s-maxage=3600' }],
      })),
      {
        // /api/* は middleware の matcher 対象外。JSON/画像が中心だが防御として静的 CSP を付与。
        source: '/api/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: blob:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(self), usb=(), fullscreen=(self), display-capture=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
    ];
  },
};

export default nextConfig;
