/**
 * eslint-plugin-carelink-safety
 *
 * CareLink 固有の Defense in Depth 規約を ESLint で強制する custom plugin。
 * Phase 3 Layer6 / ADR-0004 の最終バリア。
 *
 * Rules:
 *   - no-await-fire-and-forget: `await writeAuditLog(...)` / `await postAlert(...)` を禁止
 *   - no-bare-sentry-capture: `Sentry.captureException(...)` 直書きを禁止、`safeCaptureException` 経由
 */

'use strict';

const FIRE_AND_FORGET_FNS = new Set([
  'writeAuditLog',
  'postAlert',
  'alertError',
  'alertWarning',
  'safeCaptureException',
]);

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
  },
};
