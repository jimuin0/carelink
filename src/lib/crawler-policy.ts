// Observed collection crawlers, separate from Googlebot/Bingbot search indexing.
// This is a resource policy, never an authentication or authorization signal.
export const NON_SEARCH_CRAWLERS = ['GoogleOther', 'Amazonbot', 'Reflectionbot'];
const matchers = NON_SEARCH_CRAWLERS.map((token) =>
  new RegExp(`(?:^|[\\s(;])${token}(?:[\\s/;)-]|$)`, 'i'),
);

export function shouldBlockCollectionCrawler(path: string, method: string, userAgent: string): boolean {
  // Crawlers must be able to fetch the policy. Never intercept write methods.
  if (path === '/robots.txt' || (method !== 'GET' && method !== 'HEAD')) return false;
  return matchers.some((matcher) => matcher.test(userAgent));
}
