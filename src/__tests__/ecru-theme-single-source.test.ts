/**
 * くすみカラーのテーマが【1 箇所で定義され、全ての使用側が変数を参照している】ことを固定する。
 *
 * 🔴 なぜ必要か（実際に起きた事故）
 * 登録ページとヘッダーで同じ色を別々に持っていたため、ページ側だけ色を変えたときに
 * 【ヘッダーのロゴだけ濃い青が残り】、アイボリーの面から浮いた状態で気づかれなかった。
 * 色の直書きが 2 箇所以上あると、必ずどこかが古くなる。
 *
 * ⚠️ 見た目の良し悪しはここでは測れない。測っているのは
 * 「単一ソースが在るか」「使用側が直書きに戻っていないか」だけ。
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

/** 定義側。ここだけが実際の色コードを持ってよい。 */
const THEME_SOURCE = 'src/app/globals.css';

/** 使用側。変数参照だけで書かれていること。 */
const CONSUMERS = [
  'src/app/register/page.tsx',
  'src/components/register/RegisterForm.tsx',
  'src/components/Header.tsx',
];

/** テーマが持つトークン。増やしたらここへ足す（定義漏れを検知するため）。 */
const TOKENS = [
  '--ecru-bg',
  '--ecru-surface',
  '--ecru-line',
  '--ecru-text',
  '--ecru-muted',
  '--ecru-accent',
  '--ecru-scrim',
];

describe('くすみカラーのテーマ', () => {
  const css = read(THEME_SOURCE);

  it('globals.css に .theme-ecru が定義されている', () => {
    expect(css).toContain('.theme-ecru');
  });

  it.each(TOKENS)('%s が定義されている', (token) => {
    expect(css).toMatch(new RegExp(`${token}\\s*:\\s*#[0-9A-Fa-f]{6}`));
  });

  it('既存コンポーネント向けに --primary も束ねている（ボタンだけ色が残らないように）', () => {
    // .theme-ecru ブロックの中に --primary があること。
    const block = css.slice(css.indexOf('.theme-ecru'));
    const blockEnd = block.indexOf('}');
    expect(block.slice(0, blockEnd)).toContain('--primary');
  });

  it.each(CONSUMERS)('%s は色を直書きしていない（変数参照のみ）', (file) => {
    const source = read(file);
    // 空振り防止: そもそもテーマを使っているファイルであることを確かめる。
    expect(source).toContain('--ecru');

    // 6 桁の色コード直書きを禁止する。過去にここが 2 箇所に分かれて食い違った。
    const hardcoded = source.match(/#[0-9A-Fa-f]{6}/g) ?? [];
    expect(hardcoded).toEqual([]);
  });

  it('ヘッダーが /register でテーマを適用する（ロゴだけ浮かせない）', () => {
    const header = read('src/components/Header.tsx');
    expect(header).toContain("pathname === '/register'");
    expect(header).toContain('theme-ecru');
  });
});
