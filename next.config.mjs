/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: 'xzafxiupbflvgbarrihe.supabase.co' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // 注意: 'strict-dynamic' は nonce/hash と併用しない限り、近代ブラウザ(Chromium/WebKit)が
              // 'self' / 'unsafe-inline' / ホスト許可を全て無視し、nonce の無い <script src> を全ブロックする。
              // 本プロジェクトは nonce 機構を持たないため、'strict-dynamic' があると Next.js の
              // チャンクが読めず client JS が一切 hydrate しない（ログイン等のクライアント機能が全停止）。
              // よって 'strict-dynamic' を外し、'self'（同一オリジンのチャンク）＋'unsafe-inline'＋
              // 許可ホストで script を許可する。nonce ベース CSP への移行は将来の課題として残す。
              "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://www.clarity.ms https://va.vercel-scripts.com",
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self'",
              "img-src 'self' data: https: blob:",
              "connect-src 'self' https://xzafxiupbflvgbarrihe.supabase.co https://*.google-analytics.com https://www.clarity.ms https://va.vercel-scripts.com https://vitals.vercel-insights.com https://access.line.me https://api.line.me https://zipcloud.ibsnet.co.jp",
              "worker-src 'self'",
              "manifest-src 'self'",
              "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
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
