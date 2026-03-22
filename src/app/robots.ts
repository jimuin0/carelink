import type { MetadataRoute } from 'next';

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink-ruddy-psi.vercel.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin/', '/mypage/', '/auth/'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
