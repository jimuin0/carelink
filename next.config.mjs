/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
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
  async headers() {
    // ページ(HTML)の CSP は src/middleware.ts が per-request nonce ベースで付与する
    // （Next.js が出力する script に nonce を適用し 'unsafe-inline' を script から排除するため）。
    // ここでは middleware が対象外とする /api/* 向けの静的 CSP と、全ルート共通の
    // 非 CSP セキュリティヘッダのみを定義する（ページに静的 CSP を出すと middleware の
    // nonce CSP と二重化して衝突するため、ページには CSP を出さない）。
    return [
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
