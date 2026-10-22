/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * サービス名の表記は「CareLink」。2026年10月22日まで「CareLinK」の誤記が
 * AI チャットのあいさつ（来院者に表示）と管理画面の案内文に残っていた。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : files(p);
    return /\.(tsx?|mjs)$/.test(name) ? [p] : [];
  });
}

test('the service name is never written as CareLinK', () => {
  const offenders = files(join(process.cwd(), 'src')).filter(f => readFileSync(f, 'utf8').includes('CareLinK'));
  expect(offenders).toEqual([]);
});
