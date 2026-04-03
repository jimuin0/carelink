import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin/', '/mypage/', '/auth/'],
    },
    sitemap: 'https://www.carelink-jp.com/sitemap.xml',
  };
}
