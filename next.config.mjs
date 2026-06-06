/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
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
