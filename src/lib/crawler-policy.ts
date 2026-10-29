// Observed collection crawlers, separate from Googlebot/Bingbot search indexing.
// This is a resource policy, never an authentication or authorization signal.
// meta-externalagent (AI training/indexing) walked /search at 2 requests/s on 2026-10-29.
// Meta's link previews (facebookexternalhit) and user-initiated meta-externalfetcher stay allowed.
export const NON_SEARCH_CRAWLERS = ['GoogleOther', 'Amazonbot', 'Reflectionbot', 'meta-externalagent'];
const tokenMatcher = (token: string) => new RegExp(`(?:^|[\\s(;])${token}(?:[\\s/;)-]|$)`, 'i');
const matchers = NON_SEARCH_CRAWLERS.map(tokenMatcher);

// Search-index crawlers that are expected to honor robots.txt. Link-preview bots
// (Twitterbot, Slackbot, facebookexternalhit, LINE) are deliberately absent so a
// shared search link still unfurls.
export const SEARCH_INDEX_CRAWLERS = ['Amzn-SearchBot', 'Googlebot', 'bingbot', 'Applebot', 'DuckDuckBot',
  'YandexBot', 'Baiduspider', 'PetalBot', 'OAI-SearchBot', 'PerplexityBot'];
const searchIndexMatchers = SEARCH_INDEX_CRAWLERS.map(tokenMatcher);

export function shouldBlockCollectionCrawler(path: string, method: string, userAgent: string): boolean {
  // Crawlers must be able to fetch the policy. Never intercept write methods.
  if (path === '/robots.txt' || (method !== 'GET' && method !== 'HEAD')) return false;
  return matchers.some((matcher) => matcher.test(userAgent));
}

// robots.txt disallows /search? (filtered results are noindex). A crawler that has
// not re-read robots.txt yet is refused here instead of paying for a DB-backed render.
export function shouldRefuseFilteredSearchCrawl(path: string, search: string, method: string, userAgent: string): boolean {
  if (path !== '/search' || search.length <= 1 || (method !== 'GET' && method !== 'HEAD')) return false;
  return searchIndexMatchers.some((matcher) => matcher.test(userAgent));
}
