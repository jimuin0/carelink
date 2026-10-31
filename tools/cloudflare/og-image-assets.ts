import { env } from 'cloudflare:workers';
import wasm from '@resvg/resvg-wasm/index_bg.wasm?module';

async function asset(path: string): Promise<Response> {
  const response = await env.ASSETS.fetch(new Request(`https://assets.local/__carelink_og/${path}`));
  if (!response.ok) throw new Error('OG image asset unavailable');
  return response;
}

export async function readOgFontCss(): Promise<string> {
  return (await asset('wght.css')).text();
}

export async function readOgFont(path: string): Promise<Uint8Array> {
  return new Uint8Array(await (await asset(path)).arrayBuffer());
}

export async function loadOgWasm(): Promise<WebAssembly.Module> {
  return wasm;
}
