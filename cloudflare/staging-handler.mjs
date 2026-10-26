const syntheticOrigin = 'https://synthetic.invalid';
const localOrigins = new Set(['http://127.0.0.1:54321', 'http://localhost:54321', 'https://localhost:54330']);

export function createStagingHandler(app) {
  return {
    async fetch(request, env, context) {
      let backend;
      try { backend = new URL(env.NEXT_PUBLIC_SUPABASE_URL || syntheticOrigin); }
      catch { return new Response('Invalid staging database configuration', { status: 503 }); }
      const isolated = localOrigins.has(backend.origin);
      if (backend.origin !== syntheticOrigin && !isolated) {
        return new Response('Staging refuses a hosted database connection', { status: 503 });
      }
      if (!isolated && !['GET', 'HEAD'].includes(request.method)) {
        return new Response('Synthetic staging is read-only', { status: 503 });
      }
      if (new URL(request.url).pathname === '/robots.txt' && !isolated) {
        return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain', 'X-Robots-Tag': 'noindex' } });
      }
      let applicationRequest = request;
      if (['/_next/image', '/_vinext/image'].includes(new URL(request.url).pathname.replace(/\/$/, ''))) {
        // vinext currently negotiates AVIF ahead of next.config's WebP-only
        // format list. Keep the application's existing format policy.
        const headers = new Headers(request.headers);
        headers.set('Accept', (headers.get('Accept') || '').split(',')
          .filter(value => !value.trim().startsWith('image/avif')).join(','));
        applicationRequest = new Request(request, { headers });
      }
      const response = await app.fetch(applicationRequest, env, context);
      const safe = new Response(response.body, response);
      safe.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      // next.config.mjs marks only its fixed public asset allowlist. Translate
      // that existing edge policy while retaining the browser revalidation
      // contract; never apply it to cookies, errors, or unmarked responses.
      if (['GET', 'HEAD'].includes(request.method) && safe.status === 200
        && !safe.headers.has('Set-Cookie')
        && safe.headers.get('Vercel-CDN-Cache-Control') === 'public, s-maxage=3600') {
        safe.headers.set('Cache-Control', 'public, max-age=0');
        safe.headers.set('Cloudflare-CDN-Cache-Control', 'public, max-age=3600');
      }
      return safe;
    },
  };
}
