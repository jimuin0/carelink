import app from 'vinext/server/fetch-handler';
export * from 'vinext/server/fetch-handler';

// Match the app's WebP preference without asking a WebP-incapable browser to
// decode it. Only image negotiation is changed; all other requests are untouched.
export function preferWebp(request: Request): Request {
  if (!['GET', 'HEAD'].includes(request.method)) return request;
  if (!['/_next/image', '/_next/image/'].includes(new URL(request.url).pathname)) return request;
  const accept = request.headers.get('accept');
  if (!accept) return request;
  const tokens = accept.split(',');
  const webp = tokens.find(token => /^\s*image\/webp\s*(?:;|$)/i.test(token));
  if (!webp || /(?:^|;)\s*q\s*=\s*0(?:\.0*)?\s*(?:;|$)/i.test(webp)) return request;
  const filtered = tokens.filter(token => !/^\s*image\/avif\s*(?:;|$)/i.test(token));
  if (filtered.length === tokens.length) return request;
  const headers = new Headers(request.headers); headers.set('accept', filtered.join(','));
  return new Request(request, { headers });
}

// Vercel used to answer plain HTTP with 308 to HTTPS and www with a permanent
// redirect to the apex domain. Keep the same canonical origin so links, cookies
// and OAuth callbacks do not split.
export function canonicalRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  const toHttps = url.protocol === 'http:';
  const toApex = url.hostname === 'www.carelink-jp.com';
  if (!toHttps && !toApex) return null;
  url.protocol = 'https:';
  if (toApex) url.hostname = 'carelink-jp.com';
  return new Response(null, { status: toApex ? 301 : 308, headers: { location: url.toString() } });
}

export default {
  ...app,
  async fetch(request: Request, env: unknown, ctx: unknown) {
    return canonicalRedirect(request) ?? app.fetch(preferWebp(request), env, ctx);
  },
};
