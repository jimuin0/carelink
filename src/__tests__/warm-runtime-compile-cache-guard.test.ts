/**
 * scripts/warm-runtime-compile-cache.mjs は server.js の "preloadEntriesOnStart":false を true に
 * 置き換えて全モジュールを事前読み込みさせる。置換対象が無い（Next の出力形式が変わった）と、
 * 以前は置換が空振りしたまま /privacy の 200 だけで成功扱いになっていた。
 * 置換対象が無ければサーバーを起動する前に失敗することを固定する。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCRIPT = join(process.cwd(), 'scripts', 'warm-runtime-compile-cache.mjs');

function runWith(serverJs: string) {
  const dir = mkdtempSync(join(tmpdir(), 'warm-cache-'));
  try {
    writeFileSync(join(dir, 'server.js'), serverJs);
    const code = `import(${JSON.stringify(pathToFileURL(SCRIPT).href)}).then(m => m.warmRuntimeCompileCache({ cwd: ${JSON.stringify(dir)}, timeoutMs: 1 })).then(() => console.log('RESOLVED'), (e) => { console.log('REJECTED:' + e.message); });`;
    return spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 20_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('warm-runtime-compile-cache', () => {
  it('置換対象が無い server.js では失敗する', () => {
    const result = runWith('const nextConfig = {"experimental":{}};\n');
    expect(result.stdout).toContain('REJECTED:server.js does not contain "preloadEntriesOnStart":false');
  });

  it('次の設定は preloadEntriesOnStart:false を持つ（置換対象が実際に生成される前提）', () => {
    expect(readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8')).toMatch(/preloadEntriesOnStart:\s*false/);
  });
});
