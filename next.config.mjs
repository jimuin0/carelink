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
              // NOTE: 'strict-dynamic' was removed because it disables 'self' and host
              // allowlisting in modern browsers, requiring a per-request nonce/hash. No nonce
              // is generated here, so 'strict-dynamic' blocked ALL Next.js script chunks
              // (the entire app failed to hydrate). 'self' + 'unsafe-inline' + allowlisted
              // analytics domains is the working baseline.
              // TODO(security hardening): migrate to nonce-based CSP via middleware to drop
              // 'unsafe-inline' entirely (then 'strict-dynamic' can be reintroduced with a nonce).
              "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://www.clarity.ms https://va.vercel-scripts.com",
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self'",
              "img-src 'self' data: https: blob:",
              // wss://...supabase.co を追加（Supabase Realtime の WebSocket 接続用。
              // これが無いと RealtimeBookingListener の接続が CSP でブロックされる）
              "connect-src 'self' https://xzafxiupbflvgbarrihe.supabase.co wss://xzafxiupbflvgbarrihe.supabase.co https://*.google-analytics.com https://www.clarity.ms https://va.vercel-scripts.com https://vitals.vercel-insights.com https://access.line.me https://api.line.me https://zipcloud.ibsnet.co.jp",
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
