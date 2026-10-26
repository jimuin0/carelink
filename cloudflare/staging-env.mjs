export const SYNTHETIC_ORIGIN = 'https://synthetic.invalid';
const localDatabases = new Set(['http://127.0.0.1:54321', 'http://localhost:54321', 'https://localhost:54330']);

export function stagingEnv(input) {
  const ciBackend = input.CI === 'true' && input.GITHUB_ACTIONS === 'true' ? input.NEXT_PUBLIC_SUPABASE_URL : undefined;
  const backend = new URL(input.CARELINK_STAGING_DB_URL || ciBackend || SYNTHETIC_ORIGIN);
  if (backend.href !== `${SYNTHETIC_ORIGIN}/` && !localDatabases.has(backend.origin)) {
    throw new Error('Cloudflare staging accepts only the synthetic endpoint or the disposable local database');
  }
  if (backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) {
    throw new Error('Invalid staging database origin');
  }
  const isolated = localDatabases.has(backend.origin);
  if (isolated && input.CI !== 'true') throw new Error('Local database mode requires isolated CI');
  const anon = input.CARELINK_STAGING_ANON_KEY || input.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = input.CARELINK_STAGING_SERVICE_ROLE_KEY || input.SUPABASE_SERVICE_ROLE_KEY;
  if (isolated && (!anon || !service)) throw new Error('Isolated CI database credentials are required');
  return {
    NEXT_PUBLIC_SUPABASE_URL: backend.origin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: isolated ? anon : 'synthetic-staging-anon',
    SUPABASE_SERVICE_ROLE_KEY: isolated ? service : 'synthetic-staging-service',
    NEXT_PUBLIC_BASE_URL: isolated ? 'https://localhost:3000' : 'https://carelink-staging.tokuhal-jimuin0.workers.dev',
    ADMIN_COOKIE_SECRET: isolated ? input.ADMIN_COOKIE_SECRET || '' : 'synthetic-cloudflare-staging-admin-cookie-secret',
    SALON_REGISTRATION_V2_ENABLED: isolated ? 'true' : 'false',
  };
}
