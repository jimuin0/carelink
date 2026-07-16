/**
 * eslint-plugin-carelink-safety の `no-anon-write-rls-protected-table` ルールの単体テスト。
 *
 * 【2026年7月16日 追加・恒久予防】gbp/place（facility_profiles）の実バグ（SELECTポリシーのみで
 * 所有者ベースの書込ポリシーが無いため、anon はもちろん createServerSupabaseAuthClient
 * （ログインユーザー文脈）でも .update() が拒否/0行になり GBP連携が無音で死んでいた）と同型の
 * クラスを CI（lint）で機械的に検知するための新規ルール。
 * no-anon-select-rls-protected-table と異なり、'auth_client'（createServerSupabaseAuthClient等）
 * も flag 対象に含む点が最大の違い（対象テーブルは authクライアントでも書込できないため）。
 *
 * このルールはプラグイン本体（eslint-plugin-carelink-safety/index.js・repo ルート）に実装されて
 * おり、jest の testMatch は src/** のみを対象にするため、このテストは src/lib/__tests__/ 配下に
 * 置きつつ相対パスでプラグイン実体を require する。
 */

import { RuleTester } from 'eslint';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const plugin = require('../../../eslint-plugin-carelink-safety');

const rule = plugin.rules['no-anon-write-rls-protected-table'];

const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
});

ruleTester.run('no-anon-write-rls-protected-table', rule, {
  valid: [
    // 1. service role クライアントは対象外（RLSを完全バイパスするため真に安全）
    {
      code: `
        const admin = createServiceRoleClient();
        async function f() {
          await admin.from('facility_profiles').update({ gbp_place_id: 'x' }).eq('id', '1');
        }
      `,
    },
    // 2. 書込RLSポリシーが「ある」テーブル（例: bookings）は auth クライアントでも対象外
    {
      code: `
        async function f() {
          const supabase = await createServerSupabaseAuthClient();
          await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', '1');
        }
      `,
    },
    // 3. 関数引数として注入された SupabaseClient は対象外（呼び出し元で何のクライアントか追跡不能なため保守的に除外）
    {
      code: `
        function f(supabase: SupabaseClient) {
          return supabase.from('facility_profiles').update({ gbp_place_id: 'x' }).eq('id', '1');
        }
      `,
    },
    {
      code: `
        function f(admin: SupabaseClient) {
          return admin.from('audit_logs').insert({ action: 'x' });
        }
      `,
    },
    // 4. ctx.supabase（withRoute RouteContext）の直接チェーンは対象外
    {
      code: `
        async function handler(ctx: RouteContext) {
          return ctx.supabase.from('facility_profiles').update({ gbp_place_id: 'x' }).eq('id', '1');
        }
      `,
    },
    // 4b. ctx からの分割代入も対象外（変数追跡できないため保守的に除外）
    {
      code: `
        async function handler(ctx: RouteContext) {
          const { supabase } = ctx;
          return supabase.from('facility_profiles').update({ gbp_place_id: 'x' }).eq('id', '1');
        }
      `,
    },
    // 5. 書込RLS保護対象テーブル以外への select は対象外（このルールは書込メソッドのみが対象）
    {
      code: `
        const supabase = createServerSupabaseClient();
        async function f() {
          await supabase.from('facility_profiles').select('*');
        }
      `,
    },
    // 6. createClient の第2引数が SERVICE_ROLE_KEY を参照していれば対象外
    {
      code: `
        const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
        async function f() {
          await admin.from('facility_profiles').update({ gbp_place_id: 'x' }).eq('id', '1');
        }
      `,
    },
    // 7. cookies 配線済み createServerClient（SSR認証クライアント）でも対象テーブルには書込ポリシーが
    //    無いため本来は検知対象だが、このケースでは書込RLSポリシーがあるテーブル(bookings)を使うため
    //    valid（auth_client 自体が flag されないケースとの切り分けは invalid 側 F で確認）
    {
      code: `
        async function f() {
          const cookieStore = await cookies();
          const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            { cookies: { getAll: () => cookieStore.getAll() } }
          );
          await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', '1');
        }
      `,
    },
    // 8. __tests__ 配下は対象外（filename ベース。RuleTester は仮想 filename を渡せる）
    {
      code: `
        const supabase = createServerSupabaseClient();
        async function f() {
          await supabase.from('facility_profiles').update({ gbp_place_id: 'x' }).eq('id', '1');
        }
      `,
      filename: 'src/lib/__tests__/gbp.test.ts',
    },
  ],
  invalid: [
    // A. anon クライアントで facility_profiles を update（gbp/place 実バグと同型の中心ケース）
    {
      code: `
        const supabase = createServerSupabaseClient();
        async function f() {
          await supabase.from('facility_profiles').update({ gbp_place_id: 'x' }).eq('id', '1');
        }
      `,
      errors: [{ messageId: 'forbidden' }],
    },
    // B. auth クライアント（createServerSupabaseAuthClient）で facility_profiles を update
    //    — 実際の gbp/place バグそのもの（RLS適用でも書込ポリシーが無いため拒否される）
    {
      code: `
        async function f() {
          const supabase = await createServerSupabaseAuthClient();
          await supabase.from('facility_profiles').update({ gbp_place_id: 'x' }).eq('id', '1');
        }
      `,
      errors: [{ messageId: 'forbidden' }],
    },
    // C. insert / upsert / delete も同様に検知する
    {
      code: `
        async function f() {
          const supabase = await createServerSupabaseAuthClient();
          await supabase.from('audit_logs').insert({ action: 'x' });
        }
      `,
      errors: [{ messageId: 'forbidden' }],
    },
    {
      code: `
        async function f() {
          const supabase = await createServerSupabaseAuthClient();
          await supabase.from('facility_profiles').upsert({ id: '1', gbp_place_id: 'x' });
        }
      `,
      errors: [{ messageId: 'forbidden' }],
    },
    {
      code: `
        async function f() {
          const supabase = await createServerSupabaseAuthClient();
          await supabase.from('cron_logs').delete().eq('id', '1');
        }
      `,
      errors: [{ messageId: 'forbidden' }],
    },
    // D. createServerClient(url, ...ANON_KEY...) 束縛（cookiesオプション無し＝anon）でも検知する
    {
      code: `
        const supabase = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
        async function f() {
          await supabase.from('facility_members').update({ role: 'admin' }).eq('id', '1');
        }
      `,
      errors: [{ messageId: 'forbidden' }],
    },
    // E. TS as-expression でテーブル名がキャストされていても検知する
    {
      code: `
        const supabase = createServerSupabaseClient();
        async function f() {
          await supabase.from('facility_profiles' as 'facility_profiles').update({ gbp_place_id: 'x' }).eq('id', '1');
        }
      `,
      errors: [{ messageId: 'forbidden' }],
    },
    // F. cookies 配線済み auth クライアント（SSR）でも書込ポリシー無しテーブルへの書込は検知する
    //    （SELECT版ルールでは auth_client は常に安全扱いだが、書込版では対象テーブルに限り検知）
    {
      code: `
        async function f() {
          const cookieStore = await cookies();
          const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            { cookies: { getAll: () => cookieStore.getAll() } }
          );
          await supabase.from('facility_profiles').update({ gbp_place_id: 'x' }).eq('id', '1');
        }
      `,
      errors: [{ messageId: 'forbidden' }],
    },
    // G. await を挟んだ関数呼び出しでも判定できる
    {
      code: `
        async function f() {
          const supabase = createServerSupabaseClient();
          await supabase.from('user_points').insert({ user_id: '1', points: 100 });
        }
      `,
      errors: [{ messageId: 'forbidden' }],
    },
  ],
});
