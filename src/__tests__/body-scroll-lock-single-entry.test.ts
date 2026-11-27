/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 背景のスクロールを止める・戻すのは src/lib/body-scroll-lock.ts だけ（2026年11月27日・Codex 指摘 ML-01）。
 * メニュー・Modal・駅検索などが同時に開くとき、各部品が body.style.overflow を直接書くと、
 * 片方を閉じただけで固定が外れたり、全部閉じても固定が残ったりする。個別に直すのではなく入口を 1 つに固定する。
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..');
const ENTRY = path.join(SRC, 'lib', 'body-scroll-lock.ts');
const DIRECT = /body\.style\.overflow\s*=|body\.style\[['"]overflow['"]\]\s*=/;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : files(full);
    return /\.(?:ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
  });
}

test('body.style.overflow を直接書くのは lib/body-scroll-lock.ts だけ', () => {
  const all = files(SRC);
  expect(all.length).toBeGreaterThan(200);
  expect(DIRECT.test(fs.readFileSync(ENTRY, 'utf8'))).toBe(true);
  expect(all.filter((f) => f !== ENTRY && DIRECT.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(SRC, f))).toEqual([]);
});

test('負の対照：直接書けば検出する', () => {
  expect(DIRECT.test("document.body.style.overflow = '';")).toBe(true);
  expect(DIRECT.test("document.body.style['overflow'] = 'hidden';")).toBe(true);
  expect(DIRECT.test('const x = document.body.style.overflow;')).toBe(false);
});
