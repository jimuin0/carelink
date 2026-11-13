import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | undefined;

/**
 * 設定は「使うときに」検査する（読み込み時に throw しない・中 A47）。
 * 以前はモジュール読み込み時に throw していたため、Supabase の設定が無い環境（Vercel Preview 等）では
 * import しただけで /symptom-checker や施設ページの口コミタブの描画・ハイドレーションが壊れた。
 * supabase-browser.ts と同じ方針。
 */
function getClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を .env.local に設定してください'
    );
  }
  if (!client) client = createClient(supabaseUrl, supabaseAnonKey);
  return client;
}

/** 呼び出し側（`supabase.from(...)`）はそのまま。最初に使った時点でクライアントを作る。 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const real = getClient();
    const value = Reflect.get(real, prop, real) as unknown;
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});
