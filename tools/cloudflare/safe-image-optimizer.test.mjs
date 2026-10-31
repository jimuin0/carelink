import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
const source = readFileSync(new URL('./safe-image-optimizer.ts', import.meta.url), 'utf8');
function optimizer(response) {
  const exports = {};
  runInNewContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => {
      if (name === '@vinext/cloudflare/images/images-optimizer.runtime') return { __esModule: true, default: () => ({ transformImage: async () => response }) };
      throw new Error('unexpected module');
    } });
  return exports.default({});
}
test('valid image response is preserved', async () => {
  const response = new Response('synthetic', { status: 200, headers: { 'content-type': 'image/webp' } });
  assert.equal(await optimizer(response).transformImage(), response);
});
test('quota and non-image responses throw so the caller can return the original image', async () => {
  for (const response of [new Response('quota', { status: 429, headers: { 'content-type': 'text/plain' } }),
    new Response('error', { status: 200, headers: { 'content-type': 'text/plain' } })]) {
    await assert.rejects(optimizer(response).transformImage(), /Image transformation unavailable/);
  }
});

test('the vinext handler refetches and returns the original valid image after a failed transform', async () => {
  const { handleImageOptimization } = await import('vinext/server/image-optimization');
  const sharp = (await import('sharp')).default;
  const image = await sharp({ create: { width: 12, height: 6, channels: 3, background: '#712345' } }).webp().toBuffer();
  let reads = 0;
  const response = await handleImageOptimization(
    new Request('https://example.invalid/_next/image?url=%2Fimages%2Fsample.webp&w=256&q=75', { headers: { accept: 'image/webp' } }),
    { fetchAsset: async () => { reads++; return new Response(image, { headers: { 'content-type': 'image/webp' } }); },
      transformImage: async body => { await new Response(body).arrayBuffer(); throw new Error('synthetic quota failure'); } },
    [256], {},
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  assert.equal(reads, 2);
});
