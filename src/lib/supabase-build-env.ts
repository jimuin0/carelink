// Build-time static params are an optimisation, not a requirement: every route
// that uses them also renders on demand (dynamicParams defaults to true) and is
// revalidated by ISR. Vercel Preview builds intentionally carry no Supabase
// credentials so that preview deployments never touch the production database;
// in that case prerender nothing instead of failing the build.
export function hasSupabasePublicEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
