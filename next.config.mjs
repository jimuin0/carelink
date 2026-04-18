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
              // strict-dynamic: modern browsers ignore unsafe-inline when strict-dynamic is present.
              // Legacy browsers fall back to unsafe-inline + allowlisted domains.
              // Next step: migrate to nonce-based CSP when ready to remove unsafe-inline entirely.
              "script-src 'self' 'unsafe-inline' 'strict-dynamic' https://www.googletagmanager.com https://www.google-analytics.com https://www.clarity.ms https://va.vercel-scripts.com",
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self'",
              "img-src 'self' data: https: blob:",
              "connect-src 'self' https://xzafxiupbflvgbarrihe.supabase.co https://*.google-analytics.com https://www.clarity.ms https://va.vercel-scripts.com https://vitals.vercel-insights.com https://access.line.me https://api.line.me https://*.upstash.io https://*.ingest.sentry.io https://zipcloud.ibsnet.co.jp",
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
        ],
      },
    ];
  },
};

export default nextConfig;
