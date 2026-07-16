/**
 * eslint-plugin-carelink-safety の `no-anon-select-rls-protected-table` ルールの単体テスト。
 *
 * 【2026年7月16日 追加・恒久予防】#483/#484 と同型（anon Supabase クライアントで RLS 保護
 * テーブルを select し、RLS が常に0行を返すため無音バグになる）の発症を CI（lint）で機械的に
 * 検知するための新規ルール。src/lib/facilities.ts の getAvailableFacilityIds/
 * getMonthlyBookingCounts 実バグ根治（本コミット）と対になる回帰防止テスト。
 *
 * このルールはプラグイン本体（eslint-plugin-carelink-safety/index.js・repo ルート）に実装されて
 * おり、jest の testMatch は src/** のみを対象にするため、このテストは src/lib/__tests__/ 配下に
 * 置きつつ相対パスでプラグイン実体を require する。
 */

import { RuleTester } from 'eslint';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const plugin = require('../../../eslint-plugin-carelink-safety');

const rule = plugin.rules['no-anon-select-rls-protected-table'];

const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
});

ruleTester.run('no-anon-select-rls-protected-table', rule, {
  valid: [
    // 1. service role クライアントは対象外
    {
      code: `
        const supabase = createServiceRoleClient();
        async function f() {
          await supabase.from('bookings').select('id');
        }
      `,
    },
    // 2. auth（SSR Cookie）クライアントは対象外
    {
      code: `
        async function f() {
          const supabase = await createServerSupabaseAuthClient();
          await supabase.from('profiles').select('id');
        }
      `,
    },
    // 3. 関数引数として注入された SupabaseClient は対象外（呼び出し元で何のクライアントか追跡不能なため保守的に除外）
    {
      code: `
        function f(supabase: SupabaseClient) {
          return supabase.from('customers').select('id');
        }
      `,
    },
    {
      code: `
        function f(admin: SupabaseClient) {
          return admin.from('bookings').select('id');
        }
      `,
    },
    // 4. ctx.supabase（withRoute RouteContext）の直接チェーンは対象外
    {
      code: `
        async function handler(ctx: RouteContext) {
          return ctx.supabase.from('bookings').select('id');
        }
      `,
    },
    // 4b. ctx からの分割代入も対象外（変数追跡できないため保守的に除外）
    {
      code: `
        async function handler(ctx: RouteContext) {
          const { supabase } = ctx;
          return supabase.from('bookings').select('id');
        }
      `,
    },
    // 5. anon クライアントでも RLS 保護テーブル以外（公開データ）の select は対象外
    {
      code: `
        const supabase = createServerSupabaseClient();
        async function f() {
          await supabase.from('facility_profiles').select('*');
        }
      `,
    },
    // 6. select 以外（insert/update/upsert/delete）は対象外
    {
      code: `
        const supabase = createServerSupabaseClient();
        async function f() {
          await supabase.from('bookings').insert({ id: 1 });
          await supabase.from('bookings').update({ id: 1 });
          await supabase.from('bookings').upsert({ id: 1 });
          await supabase.from('bookings').delete();
        }
      `,
    },
    // 7. createClient の第2引数が SERVICE_ROLE_KEY を参照していれば対象外
    {
      code: `
        const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
        async function f() {
          await supabase.from('bookings').select('id');
        }
      `,
    },
    // 7b. 【実測で発見した誤検知の回帰防止】createServerClient(url, ANON_KEY, { cookies }) は
    // @supabase/ssr のSSR Cookie認証クライアント（createServerSupabaseAuthClient と同じ実体）で
    // auth.uid() が実際のログインユーザーに解決されるため anon 扱いしない
    // （src/app/api/booking/route.ts 等の実コードで誤検知していたものを恒久修正）。
    {
      code: `
        async function f() {
          const cookieStore = await cookies();
          const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            { cookies: { getAll: () => cookieStore.getAll() } }
          );
          await supabase.from('bookings').select('id');
        }
      `,
    },
    // (cookies を渡さないただの2引数 createServerClient(url, ANON_KEY) は anon のまま検知対象
    // ということは下の invalid ケース C で確認する)
    // 8. 同一ファイル内で異なる関数スコープに同名変数が別クライアントで束縛されていても
    //    正しくスコープ単位で判定できる（誤って全体をanon扱いにしない）
    {
      code: `
        async function a() {
          const supabase = createServiceRoleClient();
          return supabase.from('bookings').select('id');
        }
        async function b() {
          const supabase = createServerSupabaseClient();
          return supabase.from('facility_profiles').select('*');
        }
      `,
    },
    // 9. __tests__ 配下は対象外（filename ベース。RuleTester は仮想 filename を渡せる）
    {
      code: `
        const supabase = createServerSupabaseClient();
        async function f() {
          await supabase.from('bookings').select('id');
        }
      `,
      filename: 'src/lib/__tests__/facilities.test.ts',
    },
  ],
  invalid: [
    // A. anon クライアントで bookings を select（#483/#484 と同型の中心ケース）
    {
      code: `
        const supabase = createServerSupabaseClient();
        async function f() {
          await supabase.from('bookings').select('staff_id, start_time, end_time');
        }
      `,
      errors: [{ messageId: 'forbidden' }],
    },
    // B. anon クライアントで profiles を select
    {
      code: `
        const supabase = createServerSupabaseClient();
        async function f() {
          await supabase.from('profiles').select('*');
        }
      `,
      errors: [{ messageId: 'forbidden' }],
    },
    // C. createServerClient(url, ...ANON_KEY...) 束縛でも検知する
    {
      code: `
        const supabase = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
        async function f() {
          await supabase.from('customers').select('id');
        }
      `,
      errors: [{ messageId: 'forbidden' }],
    },
    // D. TS as-expression でテーブル名がキャストされていても検知する
    {
      code: `
        const supabase = createServerSupabaseClient();
        async function f() {
          await supabase.from('bookings' as 'bookings').select('id');
        }
      `,
      errors: [{ messageId: 'forbidden' }],
    },
    // E. await を挟んだ関数呼び出しでも anon 判定できる
    {
      code: `
        async function f() {
          const supabase = createServerSupabaseClient();
          await supabase.from('facility_members').select('*');
        }
      `,
      errors: [{ messageId: 'forbidden' }],
    },
  ],
});
