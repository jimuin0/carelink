import type { MetadataRoute } from 'next';
import { NON_SEARCH_CRAWLERS } from '@/lib/crawler-policy';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      // Parameterized /search pages are noindex already (search/page.tsx), and each
      // fetch is a full DB-backed render. A search crawler walked filter
      // combinations at 6 requests/min on 2026-10-29. /search itself, area
      // pages and facility pages stay crawlable and listed in the sitemap.
      disallow: ['/admin/', '/mypage/', '/auth/', '/api/', '/search?'],
    }, {
      userAgent: NON_SEARCH_CRAWLERS,
      disallow: '/',
    }],
    sitemap: 'https://carelink-jp.com/sitemap.xml',
  };
}
