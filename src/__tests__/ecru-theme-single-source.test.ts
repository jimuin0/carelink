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
  // /register の本体（page.tsx は掲載エリアを取って渡すだけ）。
  'src/components/register/RegisterLanding.tsx',
  // 店舗向けページのフッター（来院者向けの濃いフッターの代わり）。
  'src/components/register/ShopFooter.tsx',
  'src/components/register/RegisterForm.tsx',
  'src/components/Header.tsx',
  // 受付完了（/register/complete）も同じテーマで描く（以前はヘッダーだけ青に戻っていた）。
  'src/app/register/complete/page.tsx',
  'src/components/register/RegistrationReceipt.tsx',
  'src/components/register/SalonLocalDraftControls.tsx',
  'src/components/StepIndicator.tsx',
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

  it('ヘッダーとフッターは同じ判定（src/lib/shop-theme.ts）で店舗向けページにテーマを適用する', () => {
    const header = read('src/components/Header.tsx');
    expect(header).toContain('isEcruShopPath(pathname)');
    expect(header).toContain('theme-ecru');
    expect(read('src/components/LayoutSwitch.tsx')).toContain('isEcruShopPath(pathname) ? <ShopFooter />');
    const shopTheme = read('src/lib/shop-theme.ts');
    expect(shopTheme).toContain("'/register'");
    expect(shopTheme).toContain("'/register/complete'");
  });

  it('受付完了ページもテーマを使う', () => {
    for (const file of ['src/app/register/complete/page.tsx', 'src/components/register/RegistrationReceipt.tsx']) {
      const source = read(file);
      expect(source).toContain('theme-ecru');
      // 旧配色（sky / green の直指定）へ戻っていないこと。
      expect(source).not.toMatch(/\b(bg|text|border)-(sky|green)-\d{2,3}\b/);
    }
  });

  /**
   * ロゴはブランド色（--logo）のまま。テーマで塗り替えない（2026年10月23日 神原さん決定）。
   * 以前はロゴを var(--primary) で描いていたため、.theme-ecru が --primary を束ねた結果
   * /register でだけロゴがくすみローズになり、同じサービスのロゴに見えなかった。
   */
  it('ロゴは --logo で描き、.theme-ecru は --logo を上書きしない', () => {
    expect(css).toMatch(/:root\s*\{[^}]*--logo\s*:\s*#[0-9A-Fa-f]{6}/);
    const block = css.slice(css.indexOf('.theme-ecru {'));
    expect(block.slice(0, block.indexOf('}'))).not.toContain('--logo');
    const header = read('src/components/Header.tsx');
    const logos = header.match(/<Link href="\/" className="[^"]*"/g) ?? [];
    // 店舗向けと来院者向けの 2 つのヘッダーの両方
    expect(logos).toHaveLength(2);
    for (const logo of logos) {
      expect(logo).toContain('text-(--logo)');
      expect(logo).not.toContain('text-primary');
    }
  });

  it('エラー文の色は AA（4.5:1）を満たす濃さ（red-500 は白地 3.76:1 で不足）', () => {
    const block = css.slice(css.indexOf('@utility form-error'));
    const body = block.slice(0, block.indexOf('}'));
    expect(body).toContain('text-red-700');
    expect(body).not.toContain('text-red-500');
  });
});
