import type { MetadataRoute } from 'next';
import { NON_SEARCH_CRAWLERS } from '@/lib/crawler-policy';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      disallow: ['/admin/', '/mypage/', '/auth/', '/api/'],
    }, {
      userAgent: NON_SEARCH_CRAWLERS,
      disallow: '/',
    }],
    sitemap: 'https://carelink-jp.com/sitemap.xml',
  };
}
