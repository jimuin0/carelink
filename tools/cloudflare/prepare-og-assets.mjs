import { mkdir, readFile, copyFile, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';

// Only copy known font package files to a reserved generated asset directory.
// Never overwrite an existing different file or remove user data.
const fontDir = resolve('node_modules/@fontsource-variable/noto-sans-jp');
const outDir = resolve('public/__carelink_og');
const css = await readFile(join(fontDir, 'wght.css'), 'utf8');
const names = [...new Set([...css.matchAll(/url\((\.\/files\/[a-zA-Z0-9_-]+\.woff2)\)/g)].map((m) => m[1]))];
if (!names.length) throw new Error('No expected font subsets found');
async function safeDirectory(path, create = true) {
  if (create) {
    try { await mkdir(path); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Generated font directory must be a real directory');
}
await safeDirectory(resolve('public'), false);
await safeDirectory(outDir);
await safeDirectory(join(outDir, 'files'));
for (const name of ['wght.css', ...names]) {
  const source = join(fontDir, name);
  const target = join(outDir, name);
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'EEXIST' || !(await lstat(target)).isFile() || !(await readFile(source)).equals(await readFile(target))) {
      throw new Error(`Generated font asset conflicts with an existing file: ${name}`);
    }
  }
}
console.log(`Prepared ${names.length} font subsets for the local Worker build`);
