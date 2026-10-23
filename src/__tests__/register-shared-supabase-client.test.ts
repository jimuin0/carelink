/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * /register と /register/recover で「Multiple GoTrueClient instances detected」警告が出ていた。
 * ヘッダー等が使う共有シングルトン（supabase-browser の createBrowserSupabaseClient）とは別に、
 * 登録フォームが @/lib/supabase の createClient で 2 つ目のクライアントを作っていたため。
 * 登録の導線では共有シングルトンだけを使う。
 */
const FILES = ['src/components/register/RegisterForm.tsx', 'src/lib/salon-photo-rollback.ts'];

test.each(FILES)('%s uses the shared browser client, not a second createClient instance', file => {
  const source = readFileSync(join(process.cwd(), file), 'utf8');
  expect(source).not.toMatch(/from '@\/lib\/supabase'/);
  expect(source).toContain("import { createBrowserSupabaseClient } from '@/lib/supabase-browser';");
});
