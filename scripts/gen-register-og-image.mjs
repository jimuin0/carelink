#!/usr/bin/env node
/**
 * /register の共有画像（og:image / twitter:image）を生成する。
 *
 *   node scripts/gen-register-og-image.mjs          # 生成して書き出す
 *   node scripts/gen-register-og-image.mjs --check  # 書き出し済みの PNG が最新か検査する
 *
 * 出力: src/app/register/opengraph-image.png と twitter-image.png（同じ画像）。
 * Next.js のファイル規約で、/register の <meta property="og:image"> と
 * <meta name="twitter:image"> に自動で載る。
 *
 * 🔴 なぜ実行時生成（opengraph-image.tsx の ImageResponse）にしないか
 * ImageResponse の Edge バンドルは Vercel Hobby の上限を超える（src/app/api/og/route.ts の注記）。
 * 画像の中身は固定文言なので、ビルド前に 1 回描いて静的ファイルとして置くほうが確実。
 *
 * 🔴 色は globals.css の `.theme-ecru` から読む（単一ソース）。ここに色コードを書かない。
 * テーマの色を変えたら、このスクリプトを再実行して PNG を更新すること
 * （src/__tests__/register-og-image.test.ts が、PNG が現在のテーマ色で描かれているかを検査する）。
 */
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = ['src/app/register/opengraph-image.png', 'src/app/register/twitter-image.png'];
const WIDTH = 1200;
const HEIGHT = 630;

/** 画像に描く文言。ページの事実（掲載料・予約手数料 0 円）だけを書く。 */
export const REGISTER_OG_TEXT = {
  eyebrow: 'CareLink 店舗・施設の掲載',
  headline: '掲載料・予約手数料0円',
  sub: '予約も、集客も、ひとつに。',
  url: 'carelink-jp.com/register',
};

/** globals.css の .theme-ecru ブロックからトークンを読む。 */
export function readEcruTokens(css) {
  const start = css.indexOf('.theme-ecru {');
  if (start === -1) throw new Error('globals.css に .theme-ecru が見つからない');
  const block = css.slice(start, css.indexOf('}', start));
  const tokens = {};
  for (const [, name, value] of block.matchAll(/--(ecru-[a-z]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) {
    tokens[name] = value.toLowerCase();
  }
  for (const name of ['ecru-bg', 'ecru-surface', 'ecru-line', 'ecru-text', 'ecru-muted', 'ecru-accent']) {
    if (!tokens[name]) throw new Error(`.theme-ecru に --${name} が無い`);
  }
  return tokens;
}

export function buildRegisterOgSvg(t) {
  const serif = "'Noto Serif JP Variable', serif";
  const sans = "'Noto Sans JP Variable', sans-serif";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${t['ecru-bg']}"/>
  <rect x="48" y="48" width="${WIDTH - 96}" height="${HEIGHT - 96}" fill="${t['ecru-surface']}" stroke="${t['ecru-line']}" stroke-width="2"/>
  <text x="${WIDTH / 2}" y="190" text-anchor="middle" font-family="${sans}" font-size="30" letter-spacing="6" fill="${t['ecru-muted']}">${REGISTER_OG_TEXT.eyebrow}</text>
  <line x1="${WIDTH / 2 - 60}" y1="228" x2="${WIDTH / 2 + 60}" y2="228" stroke="${t['ecru-accent']}" stroke-width="2"/>
  <text x="${WIDTH / 2}" y="340" text-anchor="middle" font-family="${serif}" font-size="84" font-weight="600" letter-spacing="4" fill="${t['ecru-text']}">${REGISTER_OG_TEXT.headline}</text>
  <text x="${WIDTH / 2}" y="420" text-anchor="middle" font-family="${serif}" font-size="38" letter-spacing="6" fill="${t['ecru-accent']}">${REGISTER_OG_TEXT.sub}</text>
  <text x="${WIDTH / 2}" y="520" text-anchor="middle" font-family="${sans}" font-size="24" letter-spacing="2" fill="${t['ecru-muted']}">${REGISTER_OG_TEXT.url}</text>
</svg>`;
}

const FONT_FACE = /@font-face\s*\{[^}]*?src:\s*url\(([^)]+)\)[^}]*?unicode-range:\s*([^;]+);[^}]*?\}/g;
const RANGE = /U\+([0-9a-f]{1,6})(?:-([0-9a-f]{1,6}))?/gi;

async function fontsFor(cssPath, text) {
  const css = await readFile(cssPath, 'utf8');
  const points = new Set(Array.from(text, (c) => c.codePointAt(0)));
  const buffers = [];
  for (const [, rel, ranges] of css.matchAll(FONT_FACE)) {
    const hit = Array.from(ranges.matchAll(RANGE)).some(([, s, e]) => {
      const lo = parseInt(s, 16);
      const hi = parseInt(e ?? s, 16);
      for (const p of points) if (p >= lo && p <= hi) return true;
      return false;
    });
    if (hit) buffers.push(await readFile(resolve(dirname(cssPath), rel.replace(/^\.\//, ''))));
  }
  return buffers;
}

export async function renderRegisterOgPng() {
  const css = await readFile(resolve(ROOT, 'src/app/globals.css'), 'utf8');
  const svg = buildRegisterOgSvg(readEcruTokens(css));
  const text = Object.values(REGISTER_OG_TEXT).join('');
  const fontBuffers = [
    ...(await fontsFor(resolve(ROOT, 'node_modules/@fontsource-variable/noto-serif-jp/index.css'), text)),
    ...(await fontsFor(resolve(ROOT, 'node_modules/@fontsource-variable/noto-sans-jp/wght.css'), text)),
  ];
  await initWasm(await readFile(resolve(ROOT, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')));
  const renderer = new Resvg(svg, { font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Noto Sans JP Variable' } });
  const rendered = renderer.render();
  const png = Buffer.from(rendered.asPng());
  rendered.free();
  renderer.free();
  return png;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const png = await renderRegisterOgPng();
  if (process.argv.includes('--check')) {
    for (const out of OUT) {
      const current = await readFile(resolve(ROOT, out)).catch(() => null);
      if (!current || !current.equals(png)) {
        console.error(`${out} が最新ではない。node scripts/gen-register-og-image.mjs を実行してコミットすること。`);
        process.exit(1);
      }
    }
    console.log('register og image: up to date');
  } else {
    for (const out of OUT) await writeFile(resolve(ROOT, out), png);
    console.log(`wrote ${OUT.join(', ')} (${png.length} bytes)`);
  }
}
