import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const files = ['banner-eyelash.webp', 'banner-relax.webp', 'banner-hair.webp'];
export async function normalizeStaticImages(root = process.cwd()) {
  const sourceDir = join(root, 'public', 'images');
  const outputDir = join(root, 'dist', 'client', 'images');
  for (const dir of [sourceDir, outputDir]) {
    if (lstatSync(dir).isSymbolicLink() || realpathSync(dir) !== dir) throw new Error('Image directory must be a real directory');
  }
  for (const name of files) {
    const source = join(sourceDir, name), target = join(outputDir, name);
    if (lstatSync(source).isSymbolicLink() || lstatSync(target).isSymbolicLink()) throw new Error('Image symlink rejected');
    const original = readFileSync(source), copied = readFileSync(target);
    if (!original.equals(copied)) throw new Error('Generated asset differs from original');
    if (original.subarray(0, 4).toString() === 'RIFF' && original.subarray(8, 12).toString() === 'WEBP') continue;
    if (!original.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) throw new Error('Unexpected image format');
    const webp = await sharp(original).webp({ quality: 90 }).toBuffer();
    const temporary = `${target}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, webp, { flag: 'wx', mode: 0o644 }); renameSync(temporary, target); }
    finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await normalizeStaticImages(realpathSync(process.cwd()));
