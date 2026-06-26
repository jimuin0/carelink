import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin/', '/mypage/', '/auth/', '/api/'],
    },
    sitemap: 'https://carelink-jp.com/sitemap.xml',
  };
}
