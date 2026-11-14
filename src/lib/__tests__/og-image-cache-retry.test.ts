/**
 * @jest-environment node
 *
 * B5-9: 失敗した読込 Promise をキャッシュに残さない（一過性の失敗で以後ずっと OG 画像が壊れないこと）。
 */
jest.mock('@resvg/resvg-wasm', () => ({ initWasm: jest.fn(), Resvg: jest.fn() }));
jest.mock('../og-image-assets', () => ({
  readOgFontCss: jest.fn(),
  readOgFont: jest.fn(),
  loadOgWasm: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
// テストごとにモジュールのキャッシュ（CSS・フォント）を空にして読み込み直す。
function load() {
  jest.resetModules();
  const assets = require('../og-image-assets');
  const { getOgImageFontBuffers } = require('../og-image');
  return { readOgFontCss: assets.readOgFontCss as jest.Mock, readOgFont: assets.readOgFont as jest.Mock, getOgImageFontBuffers };
}

const CSS = '@font-face { font-family: x; src: url(./sub.woff2) format("woff2"); unicode-range: U+0000-FFFF; }';

test('フォント CSS の読込が一度失敗しても、次の呼び出しで読み直す', async () => {
  const { readOgFontCss, readOgFont, getOgImageFontBuffers } = load();
  readOgFontCss.mockRejectedValueOnce(new Error('transient')).mockResolvedValue(CSS);
  readOgFont.mockResolvedValue(new Uint8Array([1]));
  await expect(getOgImageFontBuffers(new URLSearchParams())).rejects.toThrow('transient');
  await expect(getOgImageFontBuffers(new URLSearchParams())).resolves.toHaveLength(1);
  expect(readOgFontCss).toHaveBeenCalledTimes(2);
});

test('フォント本体の読込が一度失敗しても、次の呼び出しで読み直す', async () => {
  const { readOgFontCss, readOgFont, getOgImageFontBuffers } = load();
  readOgFontCss.mockResolvedValue(CSS);
  readOgFont.mockRejectedValueOnce(new Error('font transient')).mockResolvedValue(new Uint8Array([2]));
  await expect(getOgImageFontBuffers(new URLSearchParams({ title: 'あ' }))).rejects.toThrow('font transient');
  const buffers = await getOgImageFontBuffers(new URLSearchParams({ title: 'あ' }));
  expect(buffers[0]).toEqual(new Uint8Array([2]));
});
