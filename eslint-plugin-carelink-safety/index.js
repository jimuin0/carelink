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
        // 従来は 'use client' ファイルのみを検査していたが、無音 miss が最も危険なのは
        // 誰も見ていないバックグラウンド（cron/webhook/service_role API route）であり、
        // そこが構造的に検査対象外だった（M-8）。クライアント/サーバを問わず全ファイルを検査する。
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
  },
};
