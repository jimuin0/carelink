/** @jest-environment node */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `btn-secondary` が /register/recover・/auth/login・/auth/signup で使われているのに
 * globals.css に定義が無く、ボタンが素の文字列のように描かれていた（押せると分からない）。
 * 画面で使う btn-* は全て globals.css の @utility に実在しなければならない。
 */
const root = join(process.cwd(), 'src');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}
const used = new Set<string>();
for (const file of files(root)) {
  for (const match of readFileSync(file, 'utf8').matchAll(/(?<![\w-])(btn-[a-z]+(?:-[a-z]+)*)(?![\w-])/g)) used.add(match[1]);
}
const css = readFileSync(join(root, 'app/globals.css'), 'utf8');

test('the scan finds the button classes the screens use (not vacuous)', () => {
  expect([...used]).toEqual(expect.arrayContaining(['btn-primary', 'btn-secondary', 'btn-outline']));
});

test.each([...used].sort())('%s is defined as a utility in globals.css', name => {
  expect(css).toMatch(new RegExp(`@utility ${name} \\{`));
});

test('btn-secondary takes its colour from --primary (AA on white and on the ecru theme)', () => {
  const block = css.slice(css.indexOf('@utility btn-secondary {'));
  const body = block.slice(0, block.indexOf('\n}\n'));
  expect(body).toContain('color: var(--primary);');
  expect(body).toContain('border-color: var(--primary);');
  expect(body).not.toMatch(/#[0-9a-f]{3,6}/i);
});
