import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required');
}

// ブラウザ用クライアントはモジュールスコープでシングルトン化する。呼び出し都度
// createBrowserClient() すると、同一ページに複数コンポーネントがマウントされた
// 場合（例: admin レイアウトのモバイル/デスクトップ両ヘッダーに同じメニューを
// 配置するケース）に GoTrueClient インスタンスが多重生成され、Supabase SDK が
// コンソールに "Multiple GoTrueClient instances detected" 警告を出す
// （auth state の二重購読・不要な getUser() 二重発火の温床にもなる）。
// 型注釈は明示的に `SupabaseClient`（型引数省略）を使う。`ReturnType<typeof
// createBrowserClient>` はオーバーロード関数の型解決の都合で `auth.getUser()` 等の
// 戻り値が実質 any に潰れ、呼び出し側で noImplicitAny エラーを誘発するため使わない。
let browserClient: SupabaseClient | undefined;

export function createBrowserSupabaseClient(): SupabaseClient {
  if (!browserClient) {
    browserClient = createBrowserClient(supabaseUrl!, supabaseAnonKey!);
  }
  return browserClient;
}
