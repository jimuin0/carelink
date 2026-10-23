/**
 * @jest-environment node
 *
 * 管理画面（店舗オーナーが使う画面）の表記と文字のコントラストの再発防止（2026年10月23日）。
 *
 * 1. 他社の製品名・業界用語を画面に出さない。
 *    「SALON BOARD」「サロンボード」「ボード」（予約表のこと）、「TODAY'S RESERVE LIST」、
 *    「バッファタイム」「時刻スナップ」「公開画像URLを失効」が実際に出ていた。オーナーは美容室に限らず
 *    鍼灸院・クリニック・ピラティス等もいるので、他社の製品名や英語の飾り文字は伝わらない。
 *    コメントの中の言及（経緯の説明）は対象外。
 *
 * 2. 意味のある文字に text-gray-400 を使わない。白地での #9CA3AF は 2.54:1 で、AA（4.5:1）にも
 *    アイコンの基準（3:1）にも届かない。175 行あったものを text-gray-500（4.83:1）以上に上げた。
 *    残してよいのは飾りのアイコン（<svg> の行）と、暗い地（bg-gray-900 のコード例）の上だけ。
 *    下の台帳は「この数より増やさない」上限。0 になったファイルは台帳から消すこと（記載が腐るのを防ぐ）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const DIRS = ['src/app/admin', 'src/components/admin'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__') return [];
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}
const SOURCES = DIRS.flatMap((dir) => files(join(ROOT, dir))).map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, 'utf8') }));

/** コメント（/* *\/・JSX の {/* *\/}・行末の //）を除いた本文。URL の https:// は残す。 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

const JARGON: [RegExp, string][] = [
  [/SALON BOARD/i, '他社の製品名'],
  [/サロンボード/, '他社の製品名（予約表と書く）'],
  [/label:\s*'ボード'/, 'ナビの「ボード」（予約表と書く）'],
  [/TODAY(&apos;|')S/i, '英語の飾り文字'],
  [/RESERVE LIST/i, '英語の飾り文字'],
  [/バッファタイム/, '業界用語（準備時間と書く）'],
  [/時刻スナップ/, '業界用語'],
  [/公開画像URL/, '技術用語'],
];

test('管理画面の本文（コメント以外）に、他社の製品名・業界用語・英語の飾り文字が無い', () => {
  const hits = SOURCES.flatMap(({ path, text }) => {
    const body = withoutComments(text);
    return JARGON.filter(([pattern]) => pattern.test(body)).map(([pattern, why]) => `${path}: ${pattern} — ${why}`);
  });
  expect(hits).toEqual([]);
});

test('コメントの除去は本文を残し、コメントだけを消す（負の対照）', () => {
  const sample = "const a = 'サロンボード'; // サロンボード\n/* SALON BOARD */ const url = 'https://example.invalid/x';";
  expect(withoutComments(sample)).toContain("'サロンボード'");
  expect(withoutComments(sample)).not.toContain('SALON BOARD');
  expect(withoutComments(sample)).toContain('https://example.invalid/x');
  expect(JARGON.some(([pattern]) => pattern.test(withoutComments(sample)))).toBe(true);
});

/** 修飾子の付かない text-gray-400（hover: / disabled: / placeholder: 等は対象外）。 */
const BARE_GRAY_400 = /(?<![:\w-])text-gray-400(?![\w-])/g;

/** 上限の台帳（理由つき）。ここに無いファイルは 0 でなければならない。 */
const LEDGER: Record<string, { max: number; reason: string }> = {
  'src/app/admin/email-setup/page.tsx': { max: 9, reason: 'bg-gray-900 のコード例の上（約 7.0:1）' },
  // 顧客の画面は別の作業（customers 一式の改修）と同時に触らないため、ここでは増やさない上限だけを掛ける。
  'src/app/admin/customers/[id]/page.tsx': { max: 3, reason: '顧客画面の改修で対応（別ブランチ）' },
  'src/components/admin/CustomersManager.tsx': { max: 9, reason: '顧客画面の改修で対応（別ブランチ）' },
};

function meaningfulGray400(text: string): number {
  return text.split('\n').filter((line) => !line.includes('<svg')).reduce((sum, line) => sum + (line.match(BARE_GRAY_400)?.length ?? 0), 0);
}

test('意味のある文字に text-gray-400 を使わない（飾りのアイコンと台帳の分だけ）', () => {
  const over = SOURCES.flatMap(({ path, text }) => {
    const count = meaningfulGray400(text);
    const max = LEDGER[path]?.max ?? 0;
    return count > max ? [`${path}: ${count}（上限 ${max}）`] : [];
  });
  expect(over).toEqual([]);
});

test('台帳に理由があり、0 になったファイルが台帳に残っていない', () => {
  for (const [path, entry] of Object.entries(LEDGER)) {
    expect({ path, reason: entry.reason.trim().length > 0 }).toEqual({ path, reason: true });
    const source = SOURCES.find((s) => s.path === path);
    expect({ path, exists: Boolean(source) }).toEqual({ path, exists: true });
    expect({ path, stale: meaningfulGray400(source!.text) === 0 }).toEqual({ path, stale: false });
  }
});

test('数え方の負の対照：修飾子つき・svg の行は数えず、素の text-gray-400 は数える', () => {
  expect(meaningfulGray400('<p className="text-xs text-gray-400">x</p>')).toBe(1);
  expect(meaningfulGray400('<input className="placeholder:text-gray-400 disabled:text-gray-400 hover:text-gray-400" />')).toBe(0);
  expect(meaningfulGray400('<svg className="w-4 h-4 text-gray-400" aria-hidden="true" />')).toBe(0);
});
