import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
const source = readFileSync(new URL('./worker-entry.ts', import.meta.url), 'utf8');
const exports = {};
let queueCall;
let forwardedRequest;
runInNewContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText,
  { exports, Request, Response, Headers, URL, require: name => {
    if (name === 'vinext/server/fetch-handler') return { __esModule: true, default: { fetch: (...args) => {forwardedRequest=args;return Promise.resolve(new Response('{}'));} } };
    if (name === './line-support-consumer') return {consumeLineSupport:async(...args)=>{queueCall=args;await args[3](new Request('https://carelink-jp.com/api/line/support-work'),args[1],args[2]);}};
    throw new Error('unexpected module');
  } });
const request = (url, accept, method = 'GET') => new Request(`https://example.invalid${url}`, { method, headers: accept ? { accept } : {} });
test('queue consumer dispatches through the application request context with the same bindings',async()=>{
  const batch={messages:[]},env={CRON_SECRET:'synthetic'},ctx={};
  await exports.default.queue(batch,env,ctx);
  assert.equal(queueCall[0],batch);assert.equal(forwardedRequest[1],env);assert.equal(forwardedRequest[2],ctx);
  assert.equal(new URL(forwardedRequest[0].url).pathname,'/api/line/support-work');
});
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
test('www is permanently redirected to the apex domain with path and query', () => {
  const response = exports.canonicalRedirect(new Request('https://www.carelink-jp.com/search?area=tokyo'));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), 'https://carelink-jp.com/search?area=tokyo');
  assert.equal(exports.canonicalRedirect(new Request('http://www.carelink-jp.com/a')).headers.get('location'), 'https://carelink-jp.com/a');
});
test('plain HTTP is redirected to HTTPS with 308 like Vercel did', () => {
  const response = exports.canonicalRedirect(new Request('http://carelink-jp.com/search?area=tokyo', { method: 'POST' }));
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), 'https://carelink-jp.com/search?area=tokyo');
});
test('the canonical HTTPS origin and other hosts pass through', () => {
  assert.equal(exports.canonicalRedirect(new Request('https://carelink-jp.com/search')), null);
  assert.equal(exports.canonicalRedirect(new Request('https://cf-check.carelink-jp.com/')), null);
});
test('only an explicitly local development binding permits the HTTP test origin',async()=>{
  forwardedRequest=undefined;
  const local=new Request('http://127.0.0.1:3190/api/line/support-knowledge');
  const response=await exports.default.fetch(local,{VERCEL_ENV:'development'},{});
  assert.equal(response.status,200);assert.equal(forwardedRequest[0],local);
});
test('production and non-local requests retain HTTPS enforcement',async()=>{
  for(const [url,env] of [['http://localhost/a',{VERCEL_ENV:'production'}],['http://carelink-jp.com/a',{VERCEL_ENV:'development'}],['http://127.0.0.1/a',null]]){
    forwardedRequest=undefined;const response=await exports.default.fetch(new Request(url),env,{});
    assert.equal(response.status,308);assert.equal(forwardedRequest,undefined);
  }
});
