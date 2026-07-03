/**
 * no-discarded-supabase-error はクライアント/サーバ問わず全ファイルを検査する（M-8）。
 * 従来 'use client' 限定だったため、無音 miss が最も危険なバックグラウンド（cron/webhook/
 * service_role API route）が構造的に検査対象外だった。この回帰を防ぐ。
 */
const { RuleTester } = require('eslint');
const plugin = require('../index.js');

const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
});

ruleTester.run('no-discarded-supabase-error', plugin.rules['no-discarded-supabase-error'], {
  valid: [
    // error も受け取っていれば server-side でも許可
    {
      code: "async function f(){ const { data, error } = await supabase.from('bookings').select('*'); return data; }",
    },
    // 'use client' 側も従来どおり許可
    {
      code: "'use client';\nasync function f(){ const { data, error } = await supabase.from('bookings').select('*'); return data; }",
    },
    // supabase クエリでない await は対象外
    {
      code: "async function f(){ const { data } = await res.json(); return data; }",
    },
  ],
  invalid: [
    // 'use client' が無い（サーバ側 route.ts 相当）でも error 破棄を検知する（M-8 の回帰防止）
    {
      code: "async function GET(){ const { data } = await supabase.from('bookings').select('*'); return data; }",
      errors: [{ messageId: 'forbidden' }],
    },
    // .rpc() でも同様
    {
      code: "async function GET(){ const { data } = await supabase.rpc('create_booking_atomic', {}); return data; }",
      errors: [{ messageId: 'forbidden' }],
    },
    // 'use client' 明記ファイルでも従来どおり検知
    {
      code: "'use client';\nasync function f(){ const { data } = await supabase.from('bookings').select('*'); return data; }",
      errors: [{ messageId: 'forbidden' }],
    },
  ],
});
