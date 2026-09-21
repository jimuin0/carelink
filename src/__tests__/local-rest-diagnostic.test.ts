/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const script = pathToFileURL(join(__dirname, '../../scripts/diagnose-local-supabase-rest.mjs')).href;
function execute(code: string) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import { projectDiagnostic, diagnose } from ${JSON.stringify(script)}; ${code}`], { env: {}, encoding: 'utf8' });
  expect(child.status).toBe(0);
  return JSON.parse(child.stdout);
}

test('typed projectionだけを出し、raw body/message/header/不明codeを漏らさない', () => {
  const result = execute(`
    const body = { code: '57014', message: 'canceling statement due to statement timeout', details: 'PRIVATE', header: 'PRIVATE' };
    console.log(JSON.stringify([
      projectDiagnostic('openapi-apikey', 500, body, 3001.9),
      projectDiagnostic('openapi-bearer', 500, { code:'PRIVATE', message:'PRIVATE' }, 1),
      projectDiagnostic('public-view-limit0', 200, null, 2)
    ]));
  `);
  expect(result).toEqual([
    { label: 'openapi-apikey', status: 500, code: '57014', statementTimeout: true, elapsedMs: 3001 },
    { label: 'openapi-bearer', status: 500, code: null, statementTimeout: false, elapsedMs: 1 },
    { label: 'public-view-limit0', status: 200, code: null, statementTimeout: false, elapsedMs: 2 },
  ]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

test('3probeだけを固定経路/認証形式で実行し、500/例外後も診断を続ける', () => {
  const result = execute(`
    const calls = []; const output = [];
    await diagnose({ STAGING_SUPABASE_URL:'http://127.0.0.1:54321', STAGING_SUPABASE_ANON_KEY:'fixture', STAGING_SUPABASE_SERVICE_ROLE_KEY:'fixture' }, async (url, init) => {
      calls.push({path:new URL(url).pathname + new URL(url).search, bearer:Boolean(init.headers.Authorization), api:Boolean(init.headers.apikey)});
      if (calls.length === 1) return new Response(JSON.stringify({ code:'57014', message:'canceling statement due to statement timeout', details:'PRIVATE' }), { status:500 });
      if (calls.length === 2) throw new Error('PRIVATE');
      return new Response('[]', { status:200 });
    }, value => output.push(JSON.parse(value)));
    console.log(JSON.stringify({calls, output}));
  `);
  expect(result.calls).toEqual([
    { path: '/rest/v1/', bearer: false, api: true },
    { path: '/rest/v1/', bearer: true, api: true },
    { path: '/rest/v1/public_reviews?select=id&limit=0', bearer: true, api: true },
  ]);
  expect(result.output.map((x: { status: number }) => x.status)).toEqual([500, 0, 200]);
  expect(result.output.every((x: { elapsedMs: number }) => Number.isInteger(x.elapsedMs))).toBe(true);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

test.each(['https://project.supabase.co', 'http://127.0.0.1.example.com:54321', 'http://localhost:54321@remote.test', 'http://localhost:54321/path', 'http://localhost:99999', ''])('非local/不正入力ではfetch前に拒否する %s', (url) => {
  expect(execute(`
    let calls=0; let refused=false;
    try { await diagnose({ STAGING_SUPABASE_URL:${JSON.stringify(url)}, STAGING_SUPABASE_ANON_KEY:'fixture', STAGING_SUPABASE_SERVICE_ROLE_KEY:'fixture' }, async () => { calls++; }, () => {}); }
    catch { refused=true; }
    console.log(JSON.stringify({calls,refused}));
  `)).toEqual({ calls: 0, refused: true });
});

test.each(['STAGING_SUPABASE_ANON_KEY', 'STAGING_SUPABASE_SERVICE_ROLE_KEY'])('資格情報未注入時はfetch前に拒否する %s', (key) => {
  expect(execute(`
    const env={ STAGING_SUPABASE_URL:'http://127.0.0.1:54321', STAGING_SUPABASE_ANON_KEY:'fixture', STAGING_SUPABASE_SERVICE_ROLE_KEY:'fixture' };
    delete env[${JSON.stringify(key)}]; let calls=0; let refused=false;
    try { await diagnose(env, async () => { calls++; }, () => {}); } catch { refused=true; }
    console.log(JSON.stringify({calls,refused}));
  `)).toEqual({ calls: 0, refused: true });
});

test('診断はlocal guard通過後であり、既存200必須Contractを置換しない', () => {
  const root = join(__dirname, '../..');
  const workflow = require('js-yaml').load(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'));
  const step = workflow.jobs['e2e-test'].steps.find((x: { name?: string }) => x.name === 'Local Supabase API contracts (no skips)');
  expect(step.run).toMatch(/check-local-supabase-contract\.mjs environment\s+node scripts\/diagnose-local-supabase-rest\.mjs\s+npm run test:contract/);
  const contract = readFileSync(join(root, 'tests/contract/supabase-contract.test.ts'), 'utf8');
  expect(contract).toContain('`${STAGING_URL}/rest/v1/`');
  expect(contract).toContain('expect(res.status).toBe(200)');
});
