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
      if (new URL(request.url).pathname === '/robots.txt') {
        return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain', 'X-Robots-Tag': 'noindex' } });
      }
      const response = await app.fetch(request, env, context);
      const safe = new Response(response.body, response);
      safe.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      return safe;
    },
  };
}
