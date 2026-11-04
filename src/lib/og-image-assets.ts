import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const FONT_DIR = resolve(process.cwd(), 'node_modules/@fontsource-variable/noto-sans-jp');
const WASM_PATH = resolve(process.cwd(), 'node_modules/@resvg/resvg-wasm/index_bg.wasm');

export function readOgFontCss(): Promise<string> {
  return readFile(resolve(FONT_DIR, 'wght.css'), 'utf8');
}

export function readOgFont(relativePath: string): Promise<Buffer> {
  return readFile(resolve(FONT_DIR, relativePath));
}

export function loadOgWasm(): Promise<Buffer> {
  return readFile(WASM_PATH);
}
