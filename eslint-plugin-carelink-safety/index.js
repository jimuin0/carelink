/**
 * eslint-plugin-carelink-safety
 *
 * CareLink 固有の Defense in Depth 規約を ESLint で強制する custom plugin。
 * Phase 3 Layer6 / ADR-0004 の最終バリア。
 *
 * Rules:
 *   - no-await-fire-and-forget: `await writeAuditLog(...)` / `await postAlert(...)` を禁止
 *   - no-bare-sentry-capture: `Sentry.captureException(...)` 直書きを禁止、`safeCaptureException` 経由
 *   - no-discarded-supabase-error: 'use client' ファイルで Supabase DB クエリの error を捨てる
 *       `const { data } = await supabase.from(...)...` を禁止（取得失敗を空状態に偽装する事故の予防）
 *   - no-anon-select-rls-protected-table: anon Supabase クライアント（createServerSupabaseClient 等）
 *       で RLS 保護テーブルを select する事故（#483/#484/facilities.ts 同型・RLSで常に0行になり
 *       「空きあり誤判定」「バッジ非表示」等の無音バグを生む）の発症前予防。
 */

'use strict';

const FIRE_AND_FORGET_FNS = new Set([
  'writeAuditLog',
  'postAlert',
  'alertError',
  'alertWarning',
  'safeCaptureException',
]);

/**
 * await された式が Supabase の DB クエリ（PostgREST `.from(...)` または `.rpc(...)`）か判定。
 * `.from`/`.rpc` を含むメンバチェーンのみ true。`supabase.auth.getUser()` や
 * `await res.json()` 等は `.from`/`.rpc` を含まないため false（＝誤検知しない）。
 */
function awaitedExprIsSupabaseQuery(awaitArg) {
  let node = awaitArg;
  let depth = 0;
  while (node && depth < 100) {
    depth++;
    if (node.type === 'CallExpression') {
      node = node.callee;
    } else if (node.type === 'MemberExpression') {
      if (
        node.property &&
        node.property.type === 'Identifier' &&
        (node.property.name === 'from' || node.property.name === 'rpc')
      ) {
        return true;
      }
      node = node.object;
    } else {
      break;
    }
  }
  return false;
}

// ─── no-anon-select-rls-protected-table ─────────────────────────────────────
//
// RLS（auth.uid() = user_id 等）で保護されたテーブルを anon Supabase クライアント
// （createServerSupabaseClient()）で select すると、RLS が常に0行を返すため
// 「満席でも空きあり」「予約件数バッジが常に非表示」のような無音バグになる
// （#483/#484・src/lib/facilities.ts の getAvailableFacilityIds/getMonthlyBookingCounts
// で2026年7月16日に発見・根治した実バグと同型）。発症前にCIで機械的に検知する。

// 調査確定：RLSで保護されており anon では正しく読めないテーブル一覧。
// SELECT のみ対象（.insert/.update/.upsert/.delete は対象外）。
const RLS_PROTECTED_TABLES = new Set([
  'profiles', 'facility_members', 'bookings', 'booking_waitlist', 'booking_calendar_events',
  'customers', 'customer_visits', 'customer_segments', 'daily_revenue_summary', 'favorites',
  'user_points', 'user_packages', 'package_usage_logs', 'user_subscriptions', 'subscription_usage_logs',
  'user_preferred_staff', 'user_coupon_codes', 'nps_surveys', 'intake_form_responses',
  'telehealth_sessions', 'treatment_plans', 'treatment_records', 'job_applications', 'api_keys',
  'audit_logs', 'cron_logs', 'cron_report_sends', 'facility_entitlements', 'facility_inquiries',
  'facility_line_settings', 'facility_notification_settings', 'facility_reminder_settings',
  'moderation_queue', 'newsletter_campaigns', 'newsletter_subscriptions', 'referral_codes',
  'referral_uses', 'reports', 'gbp_posts', 'gbp_audit_cache', 'google_calendar_tokens',
  'line_user_links', 'line_notification_logs', 'push_subscriptions', 'white_label_domains',
  'contacts', 'contact_replies', 'sent_reminders', 'email_unsubscribe_tokens', 'salons', 'job_seekers',
]);

// anon（RLSをバイパスしない・cookie無し＝auth.uid()=null）クライアントを生成する関数名。
const ANON_CLIENT_CTOR_NAMES = new Set(['createServerSupabaseClient']);
// RLSを迂回する/正しくauth.uid()を持つ、安全なクライアントを生成する関数名（誤検知回避）。
const SAFE_CLIENT_CTOR_NAMES = new Set(['createServiceRoleClient', 'createServerSupabaseAuthClient']);
// key引数の文字列（変数名・env参照）を見てanon/service-roleを判定する汎用ファクトリ関数名。
const GENERIC_CLIENT_FACTORY_NAMES = new Set(['createClient', 'createServerClient']);

/**
 * リテラル文字列値を取り出す。`'x' as 'y'` のような TS as-expression は中身を辿る。
 * テンプレートリテラル（式展開なし）も許容する。
 */
function getStringLiteralValue(node) {
  if (!node) return null;
  if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression') {
    return getStringLiteralValue(node.expression);
  }
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

/** スコープチェーンを辿って変数（Variable）を名前解決する。 */
function findVariableInScope(scope, name) {
  let s = scope;
  while (s) {
    const variable = s.set.get(name);
    if (variable) return variable;
    s = s.upper;
  }
  return null;
}

/**
 * `createServerClient(url, key, { cookies: {...} })`（@supabase/ssr）のように
 * 第3引数（options）に `cookies` プロパティを持つか判定する。cookies が配線されている
 * 場合、そのクライアントはリクエストの認証セッション（Cookie の JWT）を担いだ
 * 「ログインユーザー文脈」のクライアントであり、`createServerSupabaseAuthClient()` と
 * 同じ実体（実際 supabase-server-auth.ts 自体が内部でこの形を使っている）。
 * anon キーを渡していても auth.uid() は実際のログインユーザーに解決されるため、
 * 「RLSが常に0行を返す」対象の anon クライアントとは区別する（誤検知回避・実測で確認：
 * src/app/api/booking/route.ts 等の cookies 配線 createServerClient を anon 誤判定していた）。
 */
function callHasCookiesOption(callExpr) {
  const optionsArg = callExpr.arguments[2];
  if (!optionsArg || optionsArg.type !== 'ObjectExpression') return false;
  return optionsArg.properties.some(
    (p) =>
      p.type === 'Property' &&
      p.key &&
      ((p.key.type === 'Identifier' && p.key.name === 'cookies') ||
        (p.key.type === 'Literal' && p.key.value === 'cookies'))
  );
}

/**
 * createClient/createServerClient(url, key, ...) の key 引数テキストから
 * anon か service-role かを判定する。どちらとも判定できない場合は 'unknown'
 * （誤検知回避のため保守的に「flagしない」側に倒す）。
 */
function classifyGenericClientCall(callExpr, sourceCode) {
  if (callHasCookiesOption(callExpr)) return 'safe';
  const argsText = callExpr.arguments
    .map((a) => {
      try {
        return sourceCode.getText(a);
      } catch {
        return '';
      }
    })
    .join(' ');
  const looksAnon = /ANON_KEY/i.test(argsText);
  const looksService = /SERVICE_ROLE/i.test(argsText);
  if (looksAnon && !looksService) return 'anon';
  if (looksService && !looksAnon) return 'safe';
  return 'unknown';
}

/**
 * 変数（Variable）が「anon クライアントに束縛されている」か判定する。
 * 誤検知回避のため、以下は全て 'unknown'（＝flagしない）に倒す：
 *   - 定義が無い / 複数回定義されている（再代入等で追跡が不確実）
 *   - 定義が変数宣言以外（Parameter＝関数引数 `supabase: SupabaseClient` 等）（要件(3)）
 *   - 分割代入（`const { supabase } = ctx;` 等、RouteContext由来を含む）（要件(4)）
 *   - 初期化式が既知のクライアント生成関数呼び出しでない
 */
function classifyClientVariable(variable, sourceCode) {
  if (!variable || !variable.defs || variable.defs.length !== 1) return 'unknown';
  const def = variable.defs[0];
  if (def.type !== 'Variable') return 'unknown';
  const declarator = def.node;
  if (!declarator || declarator.type !== 'VariableDeclarator') return 'unknown';
  if (declarator.id.type !== 'Identifier') return 'unknown';
  let init = declarator.init;
  if (!init) return 'unknown';
  if (init.type === 'AwaitExpression') init = init.argument;
  if (!init || init.type !== 'CallExpression' || init.callee.type !== 'Identifier') return 'unknown';
  const calleeName = init.callee.name;
  if (ANON_CLIENT_CTOR_NAMES.has(calleeName)) return 'anon';
  if (SAFE_CLIENT_CTOR_NAMES.has(calleeName)) return 'safe';
  if (GENERIC_CLIENT_FACTORY_NAMES.has(calleeName)) return classifyGenericClientCall(init, sourceCode);
  return 'unknown';
}

module.exports = {
  rules: {
    'no-await-fire-and-forget': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'fire-and-forget 設計の関数を await しない（呼び出し側が応答完了を待たないため、await すると本体応答が遅延する）',
        },
        schema: [],
        messages: {
          forbidden:
            '{{name}} は fire-and-forget 設計です。await を外し `void {{name}}(...)` または素の `{{name}}(...)` を使ってください。',
        },
      },
      create(context) {
        return {
          AwaitExpression(node) {
            const arg = node.argument;
            if (arg && arg.type === 'CallExpression') {
              const callee = arg.callee;
              let name = null;
              if (callee.type === 'Identifier') name = callee.name;
              else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier')
                name = callee.property.name;
              if (name && FIRE_AND_FORGET_FNS.has(name)) {
                context.report({ node, messageId: 'forbidden', data: { name } });
              }
            }
          },
        };
      },
    },
    'no-bare-sentry-capture': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Sentry.captureException 直書きを禁止。Sentry SDK 自体が throw した場合に API 全体が 500 になる過去事例があり、`safeCaptureException` ヘルパー経由必須',
        },
        schema: [],
        messages: {
          forbidden:
            'Sentry.captureException を直接呼ばないでください。`@/lib/safe` の safeCaptureException を使ってください（Sentry が throw しても本体応答を守るため）。',
        },
      },
      create(context) {
        const filename = context.getFilename();
        // safe.ts 内では Sentry を直接呼ぶことを許可（このヘルパーが正規ラッパー）
        if (/src\/lib\/safe\.ts$/.test(filename)) return {};
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (
              callee.type === 'MemberExpression' &&
              callee.object.type === 'Identifier' &&
              callee.object.name === 'Sentry' &&
              callee.property.type === 'Identifier' &&
              callee.property.name === 'captureException'
            ) {
              context.report({ node, messageId: 'forbidden' });
            }
          },
        };
      },
    },
    'no-discarded-supabase-error': {
      meta: {
        type: 'problem',
        docs: {
          description:
            "'use client' コンポーネントで Supabase DB クエリの error を捨てる分割代入を禁止。" +
            '取得失敗を空配列のまま「空状態」「0件」「見つかりません」に偽装すると、管理者/ユーザーが' +
            'データ未取得を「無し」と誤認して見落とす事故につながる（共通 LoadError パターンで明示する）。',
        },
        schema: [],
        messages: {
          forbidden:
            'Supabase クエリの error を捨てています。data だけを分割代入せず error も受け取り、' +
            '失敗時は空状態に偽装せず LoadError 等で明示してください（取得失敗の空状態偽装の予防）。' +
            'mutation 等で意図的に error 不要な場合は eslint-disable-next-line で理由を明記。',
        },
      },
      create(context) {
        const sourceCode = context.getSourceCode();
        const body = sourceCode.ast.body;
        const first = body && body[0];
        const isClient =
          first &&
          first.type === 'ExpressionStatement' &&
          first.expression &&
          first.expression.type === 'Literal' &&
          first.expression.value === 'use client';
        if (!isClient) return {};
        return {
          VariableDeclarator(node) {
            if (!node.id || node.id.type !== 'ObjectPattern') return;
            if (!node.init || node.init.type !== 'AwaitExpression') return;
            let hasData = false;
            let hasError = false;
            for (const p of node.id.properties) {
              // ...rest は error を拾える可能性があるため保守的に「error あり」とみなす（誤検知回避）
              if (p.type !== 'Property') { hasError = true; continue; }
              if (p.key && p.key.type === 'Identifier') {
                if (p.key.name === 'data') hasData = true;
                if (p.key.name === 'error') hasError = true;
              }
            }
            if (hasData && !hasError && awaitedExprIsSupabaseQuery(node.init.argument)) {
              context.report({ node, messageId: 'forbidden' });
            }
          },
        };
      },
    },
    'no-anon-select-rls-protected-table': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'anon Supabase クライアント（createServerSupabaseClient 等・cookie/認証コンテキスト無し）で ' +
            'RLS 保護テーブルを select することを禁止。RLS（auth.uid()=user_id 等）は anon では常に ' +
            '0行を返すため、満席でも「空きあり」・予約件数バッジが常に非表示、のような無音バグになる ' +
            '（#483/#484・facilities.ts の getAvailableFacilityIds/getMonthlyBookingCounts と同型）。',
        },
        schema: [],
        messages: {
          forbidden:
            'anon クライアント `{{varName}}`（createServerSupabaseClient 等）で ' +
            'RLS 保護テーブル `{{table}}` を select しています。RLS により実際の行が返らず、' +
            '「0件」を正常応答と誤認する無音バグ（#483/#484 同型）になります。' +
            'createServiceRoleClient()（サーバー信頼文脈のみ）または ' +
            'createServerSupabaseAuthClient()（ログインユーザー文脈）を使ってください。',
        },
      },
      create(context) {
        const filename = context.getFilename();
        // テスト内のモック/フィクスチャは実際の Supabase クライアントではないため対象外（要件(5)）。
        if (/[\\/]__tests__[\\/]/.test(filename) || /\.test\.tsx?$/.test(filename)) return {};
        const sourceCode = context.getSourceCode();
        return {
          // `X.from('table').select(...)` の形のみを対象にする（.insert/.update/.upsert/.delete は対象外）。
          CallExpression(node) {
            const selectCallee = node.callee;
            if (
              !selectCallee ||
              selectCallee.type !== 'MemberExpression' ||
              selectCallee.property.type !== 'Identifier' ||
              selectCallee.property.name !== 'select'
            ) {
              return;
            }
            const fromCall = selectCallee.object;
            if (!fromCall || fromCall.type !== 'CallExpression') return;
            const fromCallee = fromCall.callee;
            if (
              !fromCallee ||
              fromCallee.type !== 'MemberExpression' ||
              fromCallee.property.type !== 'Identifier' ||
              fromCallee.property.name !== 'from'
            ) {
              return;
            }
            const clientExpr = fromCallee.object;
            // `ctx.supabase.from(...)` のような直接メンバーチェーンは変数追跡できないため対象外
            // （＝誤検知しない保守的な選択。要件(4)の ctx.supabase 除外とも整合）。
            if (!clientExpr || clientExpr.type !== 'Identifier') return;

            const tableName = getStringLiteralValue(fromCall.arguments[0]);
            if (!tableName || !RLS_PROTECTED_TABLES.has(tableName)) return;

            // ESLint 9 で `context.getScope()` が削除されるため、利用可能なら
            // 非推奨でない `sourceCode.getScope(node)` を使う（ESLint 8.37+）。
            const scope =
              typeof sourceCode.getScope === 'function' ? sourceCode.getScope(node) : context.getScope();
            const variable = findVariableInScope(scope, clientExpr.name);
            const kind = classifyClientVariable(variable, sourceCode);
            if (kind === 'anon') {
              context.report({
                node,
                messageId: 'forbidden',
                data: { table: tableName, varName: clientExpr.name },
              });
            }
          },
        };
      },
    },
  },
};
