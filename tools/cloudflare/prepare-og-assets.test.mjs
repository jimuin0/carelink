import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./prepare-og-assets.mjs', import.meta.url));

test('copies only named assets, is repeatable, and refuses to overwrite existing data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'carelink-og-assets-test-'));
  try {
    const font = join(dir, 'node_modules/@fontsource-variable/noto-sans-jp');
    mkdirSync(join(font, 'files'), { recursive: true });
    mkdirSync(join(dir, 'public'));
    writeFileSync(join(font, 'wght.css'), 'src: url(./files/sample.woff2)');
    writeFileSync(join(font, 'files/sample.woff2'), 'synthetic font');
    const run = () => spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
    assert.equal(run().status, 0);
    assert.equal(run().status, 0);
    const output = join(dir, 'public/__carelink_og/files/sample.woff2');
    assert.equal(readFileSync(output, 'utf8'), 'synthetic font');
    writeFileSync(output, 'existing different data');
    assert.notEqual(run().status, 0);
    assert.equal(readFileSync(output, 'utf8'), 'existing different data');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses symlinked destination directories and files without modifying their targets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'carelink-og-symlink-test-'));
  try {
    const font = join(dir, 'node_modules/@fontsource-variable/noto-sans-jp');
    const publicDir = join(dir, 'public');
    const generated = join(publicDir, '__carelink_og');
    const outside = join(dir, 'outside');
    mkdirSync(join(font, 'files'), { recursive: true });
    mkdirSync(publicDir); mkdirSync(outside);
    writeFileSync(join(font, 'wght.css'), 'src: url(./files/sample.woff2)');
    writeFileSync(join(font, 'files/sample.woff2'), 'synthetic font');
    const run = () => spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
    symlinkSync(outside, generated);
    assert.notEqual(run().status, 0);
    assert.equal(existsSync(join(outside, 'wght.css')), false);
    rmSync(generated);
    mkdirSync(generated);
    symlinkSync(outside, join(generated, 'files'));
    assert.notEqual(run().status, 0);
    assert.equal(existsSync(join(outside, 'sample.woff2')), false);
    rmSync(join(generated, 'files'));
    mkdirSync(join(generated, 'files'));
    writeFileSync(join(outside, 'unchanged.woff2'), 'synthetic font');
    symlinkSync(join(outside, 'unchanged.woff2'), join(generated, 'files/sample.woff2'));
    assert.notEqual(run().status, 0);
    assert.equal(readFileSync(join(outside, 'unchanged.woff2'), 'utf8'), 'synthetic font');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
