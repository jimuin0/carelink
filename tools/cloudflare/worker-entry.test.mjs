import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
const source = readFileSync(new URL('./worker-entry.ts', import.meta.url), 'utf8');
const exports = {};
runInNewContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText,
  { exports, Request, Response, Headers, URL, require: name => {
    if (name === 'vinext/server/fetch-handler') return { __esModule: true, default: { fetch: () => {} } };
    throw new Error('unexpected module');
  } });
const request = (url, accept, method = 'GET') => new Request(`https://example.invalid${url}`, { method, headers: accept ? { accept } : {} });
test('image requests prefer WebP only when the client accepts it', () => {
  const original = request('/_next/image?url=x', 'image/avif,image/webp,image/*;q=0.8');
  const result = exports.preferWebp(original);
  assert.equal(result.headers.get('accept'), 'image/webp,image/*;q=0.8');
  assert.equal(original.headers.get('accept'), 'image/avif,image/webp,image/*;q=0.8');
  assert.equal(exports.preferWebp(request('/_next/image/', 'image/avif,image/webp;q=0.5')).headers.get('accept'), 'image/webp;q=0.5');
});
test('other requests and browsers that cannot accept WebP retain their original Accept header', () => {
  for (const req of [request('/privacy', 'image/avif,image/webp'), request('/_next/image', 'image/avif'),
    request('/_next/image', 'image/avif,image/webp;q=0'), request('/_next/image', null),
    request('/_next/image', 'image/avif,image/webp', 'POST')]) assert.equal(exports.preferWebp(req), req);
});
