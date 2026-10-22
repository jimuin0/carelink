/**
 * /register の共有画像（og:image / twitter:image）を固定する（2026年10月23日）。
 *
 * 以前の /register は共有画像を持たず、ルートの汎用画像（青い「ネットでかんたんサロン予約」）が出ていた。
 * さらに layout.tsx と page.tsx が別々の title・description を持ち、twitter 側はルートの
 * 来院者向け文言のまま、と共有したときの見え方がページの中身と食い違っていた。
 *
 * 画像は scripts/gen-register-og-image.mjs が globals.css の .theme-ecru の色から描く静的 PNG。
 * （ImageResponse の Edge バンドルは Vercel Hobby の上限を超えるため、実行時には描かない。）
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function pngSize(buf: Buffer) {
  // PNG シグネチャ（8 バイト）→ IHDR チャンク（長さ 4・型 4・幅 4・高さ 4）
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('/register の共有画像', () => {
  it.each(['opengraph-image.png', 'twitter-image.png'])('%s が 1200×630 で置かれている', (name) => {
    const buf = readFileSync(join(ROOT, 'src/app/register', name));
    expect(pngSize(buf)).toEqual({ width: 1200, height: 630 });
    expect(buf.length).toBeLessThan(5 * 1024 * 1024); // twitter の上限 5MB
    expect(existsSync(join(ROOT, 'src/app/register', name.replace('.png', '.alt.txt')))).toBe(true);
  });

  it('og と twitter は同じ画像（共有先で見え方が食い違わない）', () => {
    const og = readFileSync(join(ROOT, 'src/app/register/opengraph-image.png'));
    const tw = readFileSync(join(ROOT, 'src/app/register/twitter-image.png'));
    expect(og.equals(tw)).toBe(true);
  });

  it('生成スクリプトは色を globals.css の .theme-ecru から読む（色コードを直書きしない）', () => {
    const script = read('scripts/gen-register-og-image.mjs');
    expect(script).toContain("readEcruTokens(css)");
    expect(script.match(/#[0-9A-Fa-f]{6}/g) ?? []).toEqual([]);
    expect(script).toContain("headline: '掲載料・予約手数料0円'");
  });

  it('metadata は page.tsx の 1 箇所だけ（layout と二重に持たない）・画像はファイル規約に任せる', () => {
    expect(existsSync(join(ROOT, 'src/app/register/layout.tsx'))).toBe(false);
    const page = read('src/app/register/page.tsx');
    expect(page).toContain("card: 'summary_large_image'");
    expect(page).toMatch(/twitter:\s*\{[^}]*title: `\$\{TITLE\} \| CareLink`/);
    expect(page).toMatch(/openGraph:\s*\{[^}]*title: `\$\{TITLE\} \| CareLink`/);
    // images を書くとファイル規約の画像と食い違う（どちらが出るかを読まないと分からなくなる）。
    expect(page).not.toMatch(/images\s*:/);
  });
});
