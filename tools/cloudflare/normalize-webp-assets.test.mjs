import { test } from 'node:test'; import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import sharp from 'sharp';
import { normalizeStaticImages } from './normalize-webp-assets.mjs';
const names = ['banner-eyelash.webp', 'banner-relax.webp', 'banner-hair.webp'];
async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'carelink-image-normalize-')));
  for (const dir of ['public/images', 'dist/client/images']) mkdirSync(join(root, dir), { recursive: true });
  const bytes = await sharp({ create: { width: 12, height: 6, channels: 3, background: '#712345' } }).jpeg().toBuffer();
  for (const name of names) for (const dir of ['public/images', 'dist/client/images']) writeFileSync(join(root, dir, name), bytes);
  return { root, bytes };
}
test('only generated copies are converted to actual WebP while source JPEG bytes remain intact', async () => {
  const { root, bytes } = await fixture();
  try {
    await normalizeStaticImages(root);
    for (const name of names) {
      assert.deepEqual(readFileSync(join(root, 'public/images', name)), bytes);
      const output = readFileSync(join(root, 'dist/client/images', name));
      assert.equal(output.subarray(0, 4).toString(), 'RIFF');
      assert.equal(output.subarray(8, 12).toString(), 'WEBP');
      assert.deepEqual([(await sharp(output).metadata()).width, (await sharp(output).metadata()).height], [12, 6]);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('refuses changed generated copies and symlink destinations without touching source', async () => {
  const { root, bytes } = await fixture(); const target = join(root, 'dist/client/images', names[0]);
  try {
    writeFileSync(target, 'not the copied file'); await assert.rejects(normalizeStaticImages(root), /differs/);
    assert.equal(readFileSync(target, 'utf8'), 'not the copied file');
    unlinkSync(target); symlinkSync(join(root, 'public/images', names[0]), target);
    await assert.rejects(normalizeStaticImages(root), /symlink/);
    assert.deepEqual(readFileSync(join(root, 'public/images', names[0])), bytes);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
