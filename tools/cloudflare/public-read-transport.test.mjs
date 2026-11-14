import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

const source = readFileSync(new URL('./public-read-transport.ts', import.meta.url), 'utf8');
const calls = [];
const exports = {};
runInNewContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText,
  { exports, fetch: (input, init) => { calls.push([input, init]); return 'response'; } });

test('Worker reads use the platform fetch without an undici dispatcher', () => {
  for (const name of ['createPublicReadFetch', 'createServiceReadFetch']) {
    calls.length = 0;
    const init = { method: 'GET', headers: { apikey: 'x' } };
    assert.equal(exports[name]('https://example.supabase.co')('https://example.supabase.co/rest/v1/t', init), 'response');
    assert.deepEqual(calls, [['https://example.supabase.co/rest/v1/t', init]]);
    assert.equal('dispatcher' in calls[0][1], false);
  }
});

test('the Worker build aliases both import paths of the Node transport', () => {
  const config = readFileSync(new URL('../../vite.config.mts', import.meta.url), 'utf8');
  assert.match(config, /"\.\/public-read-transport": path\.resolve\(root, "tools\/cloudflare\/public-read-transport\.ts"\)/);
  assert.match(config, /"@\/lib\/public-read-transport": path\.resolve\(root, "tools\/cloudflare\/public-read-transport\.ts"\)/);
});
