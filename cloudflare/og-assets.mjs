import { env } from 'cloudflare:workers';
import wasm from '@resvg/resvg-wasm/index_bg.wasm?module';
import css from '@fontsource-variable/noto-sans-jp/wght.css?raw';

const fonts = import.meta.glob('/node_modules/@fontsource-variable/noto-sans-jp/files/*.woff2', {
  eager: true, query: '?url', import: 'default',
});

// Only the OG renderer is wired to this adapter. No network filesystem or arbitrary URL reads.
export async function readFile(path, encoding) {
  if (encoding === 'utf8' && path.endsWith('/noto-sans-jp/wght.css')) return css;
  if (path.endsWith('/@resvg/resvg-wasm/index_bg.wasm')) return wasm;
  const filename = path.split('/').at(-1);
  const asset = fonts[`/node_modules/@fontsource-variable/noto-sans-jp/files/${filename}`];
  if (!asset) throw new Error('Unknown OG font asset');
  const response = await env.ASSETS.fetch(new Request(new URL(asset, 'https://assets.invalid')));
  if (!response.ok) throw new Error('OG font asset unavailable');
  return new Uint8Array(await response.arrayBuffer());
}
