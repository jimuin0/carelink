import app from 'vinext/server/fetch-handler';
import { consumeLineSupport } from './line-support-consumer';
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
  async queue(batch:Parameters<typeof consumeLineSupport>[0],env:{CRON_SECRET?:string},ctx:unknown){
    await consumeLineSupport(batch,env,ctx,(request,bindings,context)=>app.fetch(request,bindings,context));
  },
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // Local HTTP emulation has no public TLS endpoint. Production bindings keep
    // the canonical HTTPS redirect, including requests with a localhost Host.
    const localDevelopment=typeof env==='object'&&env!==null&&'VERCEL_ENV' in env&&env.VERCEL_ENV==='development'
      && ['localhost','127.0.0.1'].includes(new URL(request.url).hostname);
    return (localDevelopment?null:canonicalRedirect(request)) ?? app.fetch(preferWebp(request), env, ctx);
  },
};
