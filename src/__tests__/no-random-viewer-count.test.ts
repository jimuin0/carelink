/**
 * 乱数で作った「N人が閲覧中」を来訪者に見せないための検査（2026年10月22日 新設）。
 *
 * 【経緯】施設ページの ViewingNow は viewCount/100 に乱数 1〜3 を足した値を
 * 「N人が閲覧中」とオレンジの点滅つきで出していた。実際の同時閲覧者数とは無関係で、
 * 閲覧 0 回の施設でも 1〜3 人と表示されていた。神原さんの判断で表示を外した。
 *
 * 個々のファイル名ではなく「閲覧中の人数表示と Math.random が同じ部品にある」形で止める
 * （同じ演出を別の名前で作り直しても赤くなる）。実測の同時閲覧数（presence 等）で出す場合は
 * Math.random を使わないので、この検査には掛からない。
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src/components', 'src/app'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** コメントを除いたコードに「閲覧中」の表示と Math.random の両方があるか。 */
function showsRandomViewerCount(source: string): boolean {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return /閲覧中/.test(code) && /Math\.random\s*\(/.test(code);
}

test('検出器は旧 ViewingNow の形を捕まえ、累計の閲覧数表示は捕まえない（負の対照）', () => {
  const legacy = `
    const randomOffset = Math.floor(Math.random() * 3) + 1;
    return <span>{viewers}人が閲覧中</span>;`;
  expect(showsRandomViewerCount(legacy)).toBe(true);
  expect(showsRandomViewerCount('<span>閲覧 {facility.view_count}回</span>')).toBe(false);
  // コメントで経緯を説明するだけなら掛からない。
  expect(showsRandomViewerCount('// 「N人が閲覧中」は Math.random() で作っていたので外した\nexport {}')).toBe(false);
});

test('src/components・src/app に乱数の「閲覧中」表示が無い', () => {
  const files = SCAN_DIRS.flatMap((d) => sourceFiles(join(ROOT, d)));
  // 空振り防止: 実際に走査していること。
  expect(files.length).toBeGreaterThan(100);
  const offenders = files
    .filter((f) => showsRandomViewerCount(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f));
  expect(offenders).toEqual([]);
});
