/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

test('application fonts have pinned, integrity-checked local package sources', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  for (const family of ['noto-sans-jp', 'noto-serif-jp']) {
    const name = `@fontsource-variable/${family}`;
    expect(pkg.dependencies[name]).toBe('5.3.0');
    expect(lock.packages[''].dependencies[name]).toBe('5.3.0');
    expect(lock.packages[`node_modules/${name}`].version).toBe('5.3.0');
    expect(lock.packages[`node_modules/${name}`].integrity).toMatch(/^sha512-/);
  }
});

test('body and registration heading retain Noto families without build-time Google fetch', () => {
  const layout = read('src/app/layout.tsx');
  const register = read('src/app/register/page.tsx');
  expect(layout).toContain('@fontsource-variable/noto-sans-jp/index.css');
  expect(register).toContain('@fontsource-variable/noto-serif-jp/index.css');
  expect(layout + register).not.toMatch(/next\/font\/google/);
  const css = read('src/app/globals.css');
  expect(css).toContain('--font-noto-sans-jp: "Noto Sans JP Variable"');
  expect(css).toContain('--font-serif-jp: "Noto Serif JP Variable"');
});
