import { NON_SEARCH_CRAWLERS, shouldBlockCollectionCrawler } from '../crawler-policy';
import robots from '@/app/robots';

test.each([
  'GoogleOther',
  'Mozilla/5.0 (compatible; GoogleOther)',
  'GoogleOther-Image/1.0',
  'GoogleOther-Video/1.0',
  'Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)',
  'Reflectionbot/1.0',
  'amazonbot/0.1',
])('collection crawler is rejected before a dynamic read: %s', (agent) => {
  expect(shouldBlockCollectionCrawler('/search', 'GET', agent)).toBe(true);
  expect(shouldBlockCollectionCrawler('/privacy', 'HEAD', agent)).toBe(true);
});

test.each(['', 'Mozilla/5.0 Mobile Safari/537.36', 'Googlebot/2.1', 'Google-InspectionTool/1.0',
  'bingbot/2.0', 'Applebot/0.1', 'NotGoogleOther', 'Not-Amazonbot', 'Reflectionbotanical'])(
  'visitors and search indexing keep their existing access: %s', (agent) => {
    expect(shouldBlockCollectionCrawler('/search', 'GET', agent)).toBe(false);
  },
);

test('policy is readable and write methods still reach their existing security checks', () => {
  expect(shouldBlockCollectionCrawler('/robots.txt', 'GET', 'GoogleOther')).toBe(false);
  expect(shouldBlockCollectionCrawler('/robots.txt', 'HEAD', 'GoogleOther')).toBe(false);
  for (const method of ['POST', 'PATCH', 'DELETE', 'OPTIONS']) {
    expect(shouldBlockCollectionCrawler('/search', method, 'GoogleOther')).toBe(false);
  }
});

test('robots announces the same collection policy and preserves general search indexing', () => {
  expect(robots()).toEqual({
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/admin/', '/mypage/', '/auth/', '/api/', '/search?'] },
      { userAgent: NON_SEARCH_CRAWLERS, disallow: '/' },
    ],
    sitemap: 'https://carelink-jp.com/sitemap.xml',
  });
});

// robots.txt rules are path prefixes: only filtered search results are excluded.
test('robots excludes filtered search results but keeps search landing pages crawlable', () => {
  const [general] = robots().rules as Array<{ disallow: string[] }>;
  const blocked = (path: string) => general.disallow.some((prefix) => path.startsWith(prefix));
  expect(blocked('/search?type=%E9%8D%BC%E7%81%B8%E9%99%A2&page=2')).toBe(true);
  expect(blocked('/search')).toBe(false);
  expect(blocked('/search/area/tokyo')).toBe(false);
  expect(blocked('/facility/sample-slug')).toBe(false);
  expect(blocked('/tokyo')).toBe(false);
});
