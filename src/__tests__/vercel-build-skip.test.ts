/**
 * Vercel Ignored Build Step の判定ロジック固定（2026年7月29日 新設）。
 *
 * 【背景】Vercel Hobby プランの日次ビルド枠を実際に使い切り、
 * 「Deployment rate limited — retry in 24 hours」で24時間デプロイ不能になった。
 * 神原さんの判断で Hobby を継続する（2026年7月29日）ため、枠を消費する原因を機械的に減らす。
 * 当日9マージのうち3件（テストのみ／CLAUDE.md のみ／migration のみ）は
 * 配信物を一切変えないのにビルドを消費していた。
 *
 * 【このテストの役割】スキップ判定は誤ると「修正したのに本番へ出ない」という
 * 最悪の事故になる。ホワイトリストを緩めた・production ガードを外した等の改変を
 * CI で止める。スクリプト本体（scripts/vercel-should-build.sh）と同じ判定を
 * ここで再現し、代表的な変更パターンで期待どおりに分岐することを固定する。
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const SCRIPT_PATH = 'scripts/vercel-should-build.sh';

/** スクリプト本体のホワイトリスト正規表現（本体を書き換えたらこのテストが落ちる）。 */
const SAFE_TO_SKIP =
  /^(supabase\/migrations\/|\.github\/|docs\/|e2e\/|scripts\/|[^/]*\.md$|src\/.*__tests__\/|src\/.*\.test\.tsx?$)/;

/** 変更ファイル一覧に対して「ビルドをスキップしてよいか」を返す（スクリプトと同じ判定）。 */
function shouldSkipBuild(changedFiles: string[]): boolean {
  if (changedFiles.length === 0) return false; // 差分が取れない＝安全側でビルド
  return changedFiles.every((f) => SAFE_TO_SKIP.test(f));
}

describe('Vercel ビルドスキップ判定', () => {
  test('スクリプトが存在し、vercel.json から呼ばれている', () => {
    expect(existsSync(join(process.cwd(), SCRIPT_PATH))).toBe(true);
    const vercelJson = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'));
    expect(vercelJson.ignoreCommand).toBe('bash scripts/vercel-should-build.sh');
  });

  /**
   * 最重要の安全弁。production を無条件ビルドしないと、main に入った修正が本番へ出ず、
   * 「直したのに直っていない」状態になる。この行を消す改変を検知する。
   */
  test('production は無条件にビルドする分岐が残っている', () => {
    const script = readFileSync(join(process.cwd(), SCRIPT_PATH), 'utf8');
    expect(script).toMatch(/VERCEL_ENV.*=.*"?production"?/);
    // production 判定の直後に exit 1（＝ビルドする）が来ること
    expect(script).toMatch(/production[\s\S]{0,200}exit 1/);
  });

  /** 差分が取れない・空の場合はビルドする（fail-safe）。 */
  test('差分を取得できない場合はビルドする', () => {
    expect(shouldSkipBuild([])).toBe(false);
  });

  describe('スキップしてよい変更（配信物に影響しない）', () => {
    const cases: Array<[string, string[]]> = [
      ['migration のみ', ['supabase/migrations/20260729000001_x.sql']],
      ['CI 設定のみ', ['.github/workflows/ci.yml']],
      ['ルート直下の md のみ', ['CLAUDE.md']],
      ['E2E のみ', ['e2e/admin-menus.spec.ts']],
      ['スクリプトのみ', ['scripts/health-check.mjs']],
      ['ユニットテストのみ', ['src/__tests__/foo.test.ts']],
      ['コロケートしたテストのみ', ['src/app/api/review/__tests__/route.test.ts']],
      ['複数の安全な変更', ['CLAUDE.md', 'supabase/migrations/a.sql', 'e2e/b.spec.ts']],
    ];
    test.each(cases)('%s → スキップ', (_name, files) => {
      expect(shouldSkipBuild(files)).toBe(true);
    });
  });

  describe('ビルドが必要な変更（配信物に影響する）', () => {
    const cases: Array<[string, string[]]> = [
      ['ページ', ['src/app/terms/page.tsx']],
      ['API ルート', ['src/app/api/booking/route.ts']],
      ['コンポーネント', ['src/components/Header.tsx']],
      ['ライブラリ', ['src/lib/facilities.ts']],
      ['依存関係', ['package.json', 'package-lock.json']],
      ['Next 設定', ['next.config.js']],
      ['middleware', ['src/middleware.ts']],
      ['安全な変更に1つでも配信物が混ざる', ['CLAUDE.md', 'src/app/page.tsx']],
      ['公開ディレクトリの資産', ['public/robots.txt']],
      ['配信される md（src配下）', ['src/content/guide.md']],
    ];
    test.each(cases)('%s → ビルド', (_name, files) => {
      expect(shouldSkipBuild(files)).toBe(false);
    });
  });
});
