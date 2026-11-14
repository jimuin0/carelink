// Build-time static params are an optimisation, not a requirement: every route
// that uses them also renders on demand (dynamicParams defaults to true) and is
// revalidated by ISR. Vercel Preview builds intentionally carry no Supabase
// credentials so that preview deployments never touch the production database;
// in that case prerender nothing instead of failing the build.
export function hasSupabasePublicEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

// <link rel="preconnect"> に載せる Supabase のオリジン。接続先は NEXT_PUBLIC_SUPABASE_URL から導出し、
// 未設定・不正なら null（preconnect を出さない）。本番 ref をハードコードすると、Preview など
// 本番 DB に触れない環境まで本番ホストへ接続を張ってしまう（監査 A199）。
export function supabasePreconnectOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}
