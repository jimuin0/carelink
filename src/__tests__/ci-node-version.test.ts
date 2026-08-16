/**
 * @jest-environment node
 *
 * GitHub Actions の Node バージョン宣言が、互いに一致し、かつ package.json の engines を
 * 満たしていることを検査する。
 *
 * 🔴 なぜ必要か（2026年8月16日 実測）: 本番の Vercel は Node 24.x で動いていたのに、
 * CI は全ワークフローが Node 20 だった。つまり【ゲートが本番と4メジャー違う環境で
 * 検証していた】。この乖離は何も壊さないので誰も気づかない。さらに engines は
 * `>=20.9.0` のままで、@supabase/* が要求する `>=22.0.0` と食い違っていた
 * （npm は engines を強制しないため、npm ci が警告を35件出すだけで通り続ける）。
 *
 * 本番の値はここに書かない（Vercel 側でいつでも変わるため）。確かめ方はこれ：
 *
 *   vercel project ls        # carelink 行の Node Version 列を見る
 *
 * このテストが守るのは「宣言どうしの整合」であって「本番と一致していること」ではない。
 * 本番を上げたときは、上のコマンドで確認して workflows と engines を追随させること。
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const repoRoot = join(__dirname, '../..');
const workflowsDir = join(repoRoot, '.github/workflows');

/** ワークフロー内の `node-version: 'NN'` を全て集める。 */
function collectNodeVersions(): { file: string; version: string }[] {
  const found: { file: string; version: string }[] = [];
  for (const file of readdirSync(workflowsDir)) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
    const content = readFileSync(join(workflowsDir, file), 'utf8');
    for (const m of content.matchAll(/node-version:\s*'?"?([0-9]+(?:\.[0-9x]+)*)'?"?/g)) {
      found.push({ file, version: m[1] });
    }
  }
  return found;
}

/** `>=22.22.2` のような range から最小メジャーを取り出す。 */
function minimumMajorFromEngines(range: string): number {
  const m = range.match(/(\d+)/);
  if (!m) throw new Error(`engines.node を解釈できない: ${range}`);
  return Number(m[1]);
}

describe('CI の Node バージョン宣言', () => {
  const declarations = collectNodeVersions();

  it('【空振り防止】ワークフローから node-version を実際に検出できている', () => {
    // 正規表現が合わなくなって 0 件になると、以降の検査が全部「通った」ことになる。
    expect(declarations.length).toBeGreaterThanOrEqual(5);
  });

  it('全ワークフローで同じメジャーを使っている', () => {
    const majors = [...new Set(declarations.map((d) => d.version.split('.')[0]))];
    // ジョブごとに違うメジャーで動くと、どのジョブが本番相当なのか誰も判断できなくなる。
    expect(majors).toHaveLength(1);
  });

  it('package.json の engines を満たしている', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      engines?: { node?: string };
    };
    const range = pkg.engines?.node;
    expect(range).toBeDefined();
    const floor = minimumMajorFromEngines(range as string);
    for (const { file, version } of declarations) {
      const major = Number(version.split('.')[0]);
      // 満たしていないと、CI が「依存が動作を保証していない Node」で検証することになる。
      expect({ file, major, floor, ok: major >= floor }).toEqual({
        file,
        major,
        floor,
        ok: true,
      });
    }
  });
});
