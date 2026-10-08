/** @jest-environment node */
import { spawnSync } from 'node:child_process';

test('installed minimatch generations expand braces through both CommonJS and ESM', () => {
  // A global brace-expansion v2 override lets ordinary Jest run but breaks
  // Stryker's minimatch v10 ESM import before mutation testing can start.
  const probe = String.raw`
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const { pathToFileURL } = require('node:url');
    const lock = require('./package-lock.json');
    const directories = Object.keys(lock.packages).filter(p => p.endsWith('node_modules/minimatch'));
    assert(directories.length > 0);
    (async () => {
      const checked = [];
      for (const directory of directories) {
        const absolute = path.resolve(directory);
        const pkg = JSON.parse(fs.readFileSync(path.join(absolute, 'package.json'), 'utf8'));
        const importEntry = pkg.exports?.['.']?.import?.default || pkg.main || 'index.js';
        const apis = [require(absolute), await import(pathToFileURL(path.join(absolute, importEntry)).href)];
        for (const api of apis) {
          const match = api.minimatch || api.default?.minimatch || api.default || api;
          const expand = api.braceExpand || api.default?.braceExpand;
          assert.equal(match('asset1.ts', 'asset{1,2}.ts'), true);
          assert.equal(match('asset3.ts', 'asset{1,2}.ts'), false);
          assert.deepEqual(expand('{a,{b,c}}.ts'), ['a.ts', 'b.ts', 'c.ts']);
        }
        checked.push({ directory, version: pkg.version });
      }
      const { createRequire } = require('node:module');
      const strykerRequire = createRequire(require.resolve('@stryker-mutator/core'));
      assert(checked.some(p => strykerRequire.resolve('minimatch').startsWith(path.resolve(p.directory) + path.sep)));
      console.log(JSON.stringify(checked));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', probe], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
  });
  expect({ error: result.error?.message, stderr: result.stderr, status: result.status }).toEqual({
    error: undefined, stderr: '', status: 0,
  });
  expect(JSON.parse(result.stdout).length).toBeGreaterThan(0);
});
