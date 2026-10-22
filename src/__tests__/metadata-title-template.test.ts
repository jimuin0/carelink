/**
 * <title> に「| CareLink」が二重に付くページを作らないための検査（2026年10月22日 新設）。
 *
 * 【経緯】/register の page.tsx が title: '店舗・施設の掲載登録 | CareLink' と書いており、
 * ルート layout の title.template '%s | CareLink' がさらに付いて、本番の <title> が
 * 「店舗・施設の掲載登録 | CareLink | CareLink」になっていた（ブラウザのタブと検索結果に出る）。
 *
 * 【どう判定するか】src/app の全 page について、静的な `export const metadata` の title を
 * TypeScript の構文木から読み、Next.js 本体の title 解決（resolveTitle）を
 * Next と同じ継承規則で順に適用して、最終的な <title> を求める。
 *   - テンプレートは各セグメントの layout から子へ受け継がれる。
 *   - ただし page と同じ階層の layout（葉の layout）のテンプレートは、その page には掛からない
 *     （next/dist/lib/metadata/resolve-metadata.js の accumulateMetadata
 *      「skip the leaf layout and leaf page」）。
 *   - 文字列だけの title を持つ layout は、その下のテンプレートを無しにする。
 * generateMetadata など静的に読めない title が継承の途中にあるページは判定から外す
 * （外した数も主張して、検査が空振りしていないことを確かめる）。
 *
 * 本番で実測した 2 件（/register の二重化・/salon/demo の非二重化）を同じ計算で再現できることを
 * 先に確かめてから、全ページへ当てる。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import ts from 'typescript';
// Next.js 本体の title 解決（テンプレートの適用規則を自前で書き直さないため）。
const { resolveTitle } = require('next/dist/lib/metadata/resolvers/resolve-title') as {
  resolveTitle: (
    title: unknown,
    stashedTemplate: string | null,
  ) => { absolute: string; template: string | null };
};

const APP = join(process.cwd(), 'src/app');
const UNKNOWN = Symbol('unknown');
type TitleValue = string | { default?: string; template?: string; absolute?: string };
type StaticTitle = TitleValue | undefined | typeof UNKNOWN;

function stringValue(node: ts.Expression): string | typeof UNKNOWN {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return UNKNOWN;
}

/** ファイルの静的 metadata.title。title が無ければ undefined、読めなければ UNKNOWN。 */
function staticTitle(file: string): StaticTitle {
  if (!existsSync(file)) return undefined;
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result: StaticTitle = undefined;
  for (const stmt of src.statements) {
    const exported = ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === 'generateMetadata') return UNKNOWN;
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      if (decl.name.text === 'generateMetadata') return UNKNOWN;
      if (decl.name.text !== 'metadata' || !decl.initializer) continue;
      let init: ts.Expression = decl.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
      if (!ts.isObjectLiteralExpression(init)) return UNKNOWN;
      for (const prop of init.properties) {
        if (ts.isSpreadAssignment(prop)) return UNKNOWN;
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name) || prop.name.text !== 'title') continue;
        if (ts.isObjectLiteralExpression(prop.initializer)) {
          const obj: Record<string, string> = {};
          for (const p of prop.initializer.properties) {
            if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) return UNKNOWN;
            const v = stringValue(p.initializer);
            if (v === UNKNOWN) return UNKNOWN;
            obj[p.name.text] = v;
          }
          result = obj;
        } else {
          result = stringValue(prop.initializer);
        }
      }
    }
  }
  return result;
}

/**
 * Next の accumulateMetadata と同じ順序で title を解決する。
 * items は [root layout, 各セグメントの layout（無ければ undefined）…, page]。
 */
function resolveChain(items: StaticTitle[]): string | typeof UNKNOWN {
  let resolved: { absolute: string; template: string | null } | undefined;
  let template: string | null = null;
  for (let i = 0; i < items.length; i++) {
    const title = items[i];
    if (title === UNKNOWN) return UNKNOWN;
    if (title !== undefined) resolved = resolveTitle(title, template);
    if (i < items.length - 2) template = resolved?.template ?? null;
  }
  return resolved?.absolute ?? '';
}

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'api' || name === '__tests__' || name.startsWith('@')) continue;
      out.push(...pagesUnder(full));
    } else if (name === 'page.tsx' || name === 'page.ts') {
      out.push(full);
    }
  }
  return out;
}

/** page の <title> を求めるための items（root から page のセグメントまでの layout ＋ page）。 */
function itemsFor(page: string, override?: { file: string; title: StaticTitle }): StaticTitle[] {
  const read = (file: string) => (override && file === override.file ? override.title : staticTitle(file));
  const segments = relative(APP, join(page, '..')).split(sep).filter(Boolean);
  const items: StaticTitle[] = [read(join(APP, 'layout.tsx'))];
  for (let i = 1; i <= segments.length; i++) items.push(read(join(APP, ...segments.slice(0, i), 'layout.tsx')));
  items.push(read(page));
  return items;
}

const DUPLICATED = /\|\s*CareLink.*\|\s*CareLink/;

test('計算は本番の実測と一致する（/register の旧 title は二重・/salon/demo は二重にならない）', () => {
  const registerPage = join(APP, 'register/page.tsx');
  expect(resolveChain(itemsFor(registerPage, { file: registerPage, title: '店舗・施設の掲載登録 | CareLink' }))).toBe(
    '店舗・施設の掲載登録 | CareLink | CareLink',
  );
  // salon/layout が文字列 title でテンプレートを打ち消すため、子の demo では二重にならない。
  expect(resolveChain(itemsFor(join(APP, 'salon/demo/page.tsx')))).toBe('管理画面デモ | CareLink');
});

test('/register の <title> は「店舗・施設の掲載登録 | CareLink」', () => {
  expect(resolveChain(itemsFor(join(APP, 'register/page.tsx')))).toBe('店舗・施設の掲載登録 | CareLink');
});

test('静的に読める全ページで <title> に「| CareLink」が二重に付かない', () => {
  const pages = pagesUnder(APP);
  const checked: string[] = [];
  const duplicated: string[] = [];
  for (const page of pages) {
    const title = resolveChain(itemsFor(page));
    if (title === UNKNOWN) continue;
    checked.push(relative(APP, page));
    if (DUPLICATED.test(title)) duplicated.push(`${relative(APP, page)} → ${title}`);
  }
  // 空振り防止: 実際に多数のページを判定していること。
  expect(pages.length).toBeGreaterThan(100);
  expect(checked.length).toBeGreaterThan(50);
  expect(checked).toContain(join('register', 'page.tsx'));
  expect(duplicated).toEqual([]);
});
