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

export default {
  ...app,
  async fetch(request: Request, env: unknown, ctx: unknown) {
    return app.fetch(preferWebp(request), env, ctx);
  },
};
