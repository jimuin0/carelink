/**
 * Feature Flags 画面の「未接続」表示を、コードの実態と結びつけておく（2026年10月22日）。
 *
 * 🔴 なぜ必要か
 * /admin/feature-flags は「緊急停止スイッチ」「反映まで5分程度」と書いていたが、feature_flags を
 * 読んで動作を変える箇所はアプリに 1 つも無かった。障害時に OFF にしても機能は止まらず、
 * 画面は「更新しました」と返していた。神原さん決定（同日）で配線はせず、画面を「未接続」と正直に直した。
 *
 * 【この検査の性質】
 * - 画面が再び「止められる」「反映される」と約束したら落とす。
 * - 逆に、誰かがフラグを実際に読むようにしたら（isFeatureEnabled 等の呼び出し・feature_flags の読み取りを
 *   管理 API 以外に足したら）落とす。その時は「未接続」表示が嘘になるので、画面と一緒に直すこと。
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** feature_flags 表に触ってよいのは、管理画面の一覧・更新 API と、呼び出し元の無い lib だけ。 */
const TABLE_ACCESS_ALLOWED = new Set([
  'src/lib/feature-flags.ts',
  'src/app/api/admin/feature-flags/route.ts',
  'src/app/api/admin/feature-flags/[id]/route.ts',
]);
/** フラグ判定・A/B 振り分け・計測の lib。これらを import した時点で「接続」になる。 */
const FLAG_LIBS = new Set(['src/lib/feature-flags.ts', 'src/lib/ab-testing.ts']);
const READER = /\b(isFeatureEnabled|getAllFlags|getVariant|trackAbEvent)\s*\(/;
const IMPORTS_FLAG_LIB = /(from\s+|import\(\s*)['"]([^'"]*\blib|\.)\/(feature-flags|ab-testing)['"]/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__') out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const files = sourceFiles(join(ROOT, 'src')).map((f) => relative(ROOT, f).split('\\').join('/'));
const codeOf = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('Feature Flags は未接続であり、画面もそう表示している', () => {
  it('走査が空振りしていない', () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files).toEqual(expect.arrayContaining([...TABLE_ACCESS_ALLOWED]));
  });

  it('検出器は「フラグを読む」コードを検出できる（負の対照）', () => {
    expect(READER.test("if (await isFeatureEnabled('intake_forms')) {")).toBe(true);
    expect(IMPORTS_FLAG_LIB.test("import { isFeatureEnabled } from '@/lib/feature-flags';")).toBe(true);
    expect(IMPORTS_FLAG_LIB.test("import { trackAbEvent } from '../../lib/ab-testing';")).toBe(true);
    expect(IMPORTS_FLAG_LIB.test("const { getVariant } = await import('./ab-testing');")).toBe(true);
    expect(IMPORTS_FLAG_LIB.test("import Page from '@/app/admin/feature-flags/page';")).toBe(false);
  });

  it('フラグ判定の lib をどこからも呼んでいない（＝どのフラグも動作に効いていない）', () => {
    const wired = files
      .filter((f) => !FLAG_LIBS.has(f))
      .filter((f) => { const code = codeOf(f); return IMPORTS_FLAG_LIB.test(code) || READER.test(code); });
    expect(wired).toEqual([]);
  });

  it('feature_flags 表を読むのは管理 API と呼び出し元の無い lib だけ', () => {
    const readers = files.filter((f) => /from\(\s*['"`]feature_flags['"`]\s*\)/.test(codeOf(f)));
    expect(readers.filter((f) => !TABLE_ACCESS_ALLOWED.has(f))).toEqual([]);
  });

  it('Feature Flags 画面は「未接続」と表示し、緊急停止・反映時間を約束しない', () => {
    const page = read('src/app/admin/feature-flags/page.tsx');
    const jsx = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(jsx).toMatch(/未接続（切り替えても動作は変わりません）/);
    expect(jsx).not.toMatch(/緊急停止|反映まで/);
  });

  it('A/Bテスト画面は、ロールアウト率を設定するとテストが始まるとは書かない', () => {
    const page = read('src/app/admin/ab-tests/page.tsx');
    const jsx = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(jsx).not.toMatch(/A\/Bテストが開始されます|A\/Bテストを実行/);
    expect(jsx).toMatch(/まだ実行できません/);
  });
});
