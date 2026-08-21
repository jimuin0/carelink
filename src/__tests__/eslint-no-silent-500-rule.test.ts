/**
 * @jest-environment node
 *
 * eslint-plugin-carelink-safety の `no-silent-500` ルール単体テスト。
 *
 * 【背景】`src/app/api/**\/route.ts` は130本あり、`withRoute` を使っているのは11本だけ。
 * 残りは catch して `NextResponse.json({error}, {status:500})` を直接返しており、Slack 通知
 * （`@/lib/with-route` の `alertCaughtError` 経由）が発火しない。既存の
 * `src/__tests__/silent-500-guard.test.ts` は「近接ヒューリスティック（±400字以内に通知呼び出し
 * があるか）」で検査しているが、これは原理的に偽陰性を出しうる（近くに通知呼び出しがあっても
 * 実際には別の return 経路を通っている可能性を排除できない）。
 *
 * `no-silent-500` はヒューリスティックではなく構文そのものを禁止する ESLint ルールで、
 * 500 応答を直接組み立てる4形（NextResponse.json / Response.json / new NextResponse /
 * new Response、いずれも { status: 500 }）の出現そのものを機械的に検出する。
 *
 * このテストは ESLint の RuleTester を使い、正例（エラーが出ない）と負例（エラーが出る）の
 * 両方を検証する。
 */
import { RuleTester } from 'eslint';

// @typescript-eslint/parser は CJS モジュール（named export のみ・default 無し）のため、
// ESM の `import ... from` 経由だと babel/SWC の interop 変換で default が正しく解決されず
// 「Unexpected token :」（TS の型注釈をパースできない espree へフォールバックしてしまう）
// を起こす。require() で直接取得する。
// （no-require-imports は eslint.config.mjs の carelink/tests ブロックで既に off のため
// eslint-disable コメントは不要＝付けると「unused eslint-disable directive」警告になる）
const tsParser = require('@typescript-eslint/parser');
// eslint-plugin-carelink-safety は worktree 直下の実体を相対 import する
// （eslint.config.mjs と同じ理由＝node_modules の symlink 状態に依存しないため）。
const carelinkSafety = require('../../eslint-plugin-carelink-safety/index.js');

const rule = carelinkSafety.rules['no-silent-500'];

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parser: tsParser,
  },
});

describe('carelink-safety/no-silent-500', () => {
  // ESLint の RuleTester は内部で describe/it（Jest/Mocha 両対応）を生成するため、
  // 自前の it() でくくると「Tests cannot be nested」で失敗する。ここでは run() を
  // describe 直下で直接呼び出す（RuleTester が個々のケースごとに it を生成する）。
  {
    ruleTester.run('no-silent-500', rule, {
      valid: [
        // (b) serverError(...) の戻り値をそのまま return する形は許可
        {
          name: 'serverError(...) をそのまま return する',
          filename: 'src/app/api/foo/route.ts',
          code: `
            import { serverError } from '@/lib/with-route';
            export async function POST(req: Request) {
              try {
                return NextResponse.json({ ok: true });
              } catch (e) {
                return serverError('foo', e, '/api/foo');
              }
            }
          `,
        },
        // (c) status: 500 でも src/lib/ 配下なら対象外（serverError 自身の内部実装）
        {
          name: 'src/lib/with-route.ts 自体（serverError の内部実装）は対象外',
          filename: 'src/lib/with-route.ts',
          code: `
            export function serverError(tag, cause, route, userMessage = 'サーバーエラーが発生しました') {
              return NextResponse.json({ error: userMessage }, { status: 500 });
            }
          `,
        },
        // (d) 500 以外のステータスは対象外
        {
          name: 'status: 400 は対象外',
          filename: 'src/app/api/foo/route.ts',
          code: `
            export async function POST(req: Request) {
              return NextResponse.json({ error: 'bad request' }, { status: 400 });
            }
          `,
        },
        // route.ts 以外のファイル（例: コンポーネント）は対象外
        {
          name: 'route.ts 以外は対象外',
          filename: 'src/components/Foo.tsx',
          code: `
            function build() {
              return NextResponse.json({ error: 'x' }, { status: 500 });
            }
          `,
        },
        // 502 / 503 はこのルールの対象外（serverError が 500 固定のため代替手段が無い）
        {
          name: 'status: 502 は対象外',
          filename: 'src/app/api/foo/route.ts',
          code: `
            export async function GET() {
              return NextResponse.json({ error: 'bad gateway' }, { status: 502 });
            }
          `,
        },
        {
          name: 'status: 503 は対象外',
          filename: 'src/app/api/foo/route.ts',
          code: `
            export async function GET() {
              return NextResponse.json({ error: 'unavailable' }, { status: 503 });
            }
          `,
        },
      ],
      invalid: [
        // (a) + (e) 4形すべてが検出される
        {
          name: 'NextResponse.json(x, { status: 500 }) を直接構築',
          filename: 'src/app/api/foo/route.ts',
          code: `
            export async function GET(req: Request) {
              try {
                return NextResponse.json({ ok: true });
              } catch (e) {
                return NextResponse.json({ error: 'x' }, { status: 500 });
              }
            }
          `,
          errors: [{ messageId: 'forbidden' }],
        },
        {
          name: 'Response.json(x, { status: 500 }) を直接構築',
          filename: 'src/app/api/bar/route.ts',
          code: `
            export async function GET(req: Request) {
              try {
                return Response.json({ ok: true });
              } catch (e) {
                return Response.json({ error: 'x' }, { status: 500 });
              }
            }
          `,
          errors: [{ messageId: 'forbidden' }],
        },
        {
          name: 'new NextResponse(x, { status: 500 }) を直接構築',
          filename: 'src/app/api/baz/route.ts',
          code: `
            export async function GET(req: Request) {
              try {
                return NextResponse.json({ ok: true });
              } catch (e) {
                return new NextResponse('internal error', { status: 500 });
              }
            }
          `,
          errors: [{ messageId: 'forbidden' }],
        },
        {
          name: 'new Response(x, { status: 500 }) を直接構築',
          filename: 'src/app/api/qux/[id]/route.ts',
          code: `
            export async function GET(req: Request) {
              try {
                return Response.json({ ok: true });
              } catch (e) {
                return new Response('internal error', { status: 500 });
              }
            }
          `,
          errors: [{ messageId: 'forbidden' }],
        },
        // 同一ハンドラ内に複数の直接構築があれば複数件検出される
        {
          name: '同一ファイル内の複数箇所を検出する',
          filename: 'src/app/api/multi/route.ts',
          code: `
            export async function GET(req: Request) {
              if (Math.random() > 0.5) {
                return NextResponse.json({ error: 'a' }, { status: 500 });
              }
              return new Response('b', { status: 500 });
            }
          `,
          errors: [{ messageId: 'forbidden' }, { messageId: 'forbidden' }],
        },
      ],
    });
  }
});
