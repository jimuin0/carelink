/**
 * @jest-environment node
 *
 * package.json の `engines.node` が、実際にインストールされている依存の要求を満たしているかを
 * 依存側から【導出して】検査する。
 *
 * 🔴 なぜ必要か
 * engines.node は手で書いた宣言なので、依存が要求を上げても誰も直さない限り古いまま残る。
 * npm は engines を強制しない（EBADENGINE は警告のみで install は成功する）ので、
 * 【宣言が嘘になっても何も起きない】。気づくのは、宣言を信じて古い Node を使った人が
 * 実行時に落ちたときになる。
 *
 * 実際、この値は過去に `>=20.9.0` のまま放置され、@supabase/* が要求する `>=22.0.0` と
 * 食い違っていた（2026年8月16日に発覚）。人が気づく仕組みが無かったのが原因なので、
 * 人ではなく依存そのものを正とする。
 *
 * ⚠️ ci-node-version.test.ts とは見ているものが違う。あちらは「CI の宣言どうしが揃っていて、
 * かつ engines を満たすか」＝宣言間の整合。こちらは「engines 自体が実態と合っているか」。
 * どちらか片方では、両方が揃って古びた場合に気づけない。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

// semver は devDependency として明示している（推移的依存に頼ると、それが消えた日に
// この検査の意味だけが静かに失われるため）。
const semver = require('semver') as {
  minVersion(range: string): { version: string } | null;
  satisfies(version: string, range: string): boolean;
};

const repoRoot = join(__dirname, '../..');

interface PackageJson {
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
}

const rootPkg = readPackageJson(join(repoRoot, 'package.json'));

/** 直接依存のうち、Node バージョンを要求しているものを実インストールから集める。 */
function declaredNodeRequirements(): Array<{ name: string; range: string }> {
  const names = [
    ...Object.keys(rootPkg.dependencies ?? {}),
    ...Object.keys(rootPkg.devDependencies ?? {}),
  ];
  const requirements: Array<{ name: string; range: string }> = [];
  for (const name of names) {
    let pkg: PackageJson;
    try {
      pkg = readPackageJson(join(repoRoot, 'node_modules', name, 'package.json'));
    } catch {
      // 未インストール（file: 参照の自作プラグイン等）は対象外。
      continue;
    }
    const range = pkg.engines?.node;
    if (range) requirements.push({ name, range });
  }
  return requirements;
}

describe('engines.node が依存の要求を満たしている', () => {
  const requirements = declaredNodeRequirements();

  it('【空振り防止】依存から要求を実際に集められている', () => {
    // 収集が 0 件になると以降の検査が全部「通った」ことになる。
    expect(requirements.length).toBeGreaterThanOrEqual(10);
  });

  it('engines.node が宣言されていて、最小バージョンを決定できる', () => {
    expect(rootPkg.engines?.node).toBeDefined();
    expect(semver.minVersion(rootPkg.engines?.node as string)).not.toBeNull();
  });

  it('宣言した最小バージョンで、全ての直接依存が動作対象に入る', () => {
    const floor = semver.minVersion(rootPkg.engines?.node as string);
    const floorVersion = (floor as { version: string }).version;

    const violations = requirements
      .filter((r) => !semver.satisfies(floorVersion, r.range))
      .map((r) => `${r.name} は Node ${r.range} を要求（宣言は ${floorVersion}）`);

    // 落ちたら package.json の engines.node を、ここに出た要求を満たす値へ上げること。
    // 併せて .github/workflows/*.yml の node-version と本番（Vercel）の Node も確認する。
    expect(violations).toEqual([]);
  });
});
