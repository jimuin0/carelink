/**
 * @jest-environment node
 *
 * schema-snapshot.json が database.types.ts と同期しているかの恒久ガード。
 * types を変更して再生成を忘れると CI が落ちる(ドリフト監視の期待値が陳腐化するのを防ぐ)。
 */
import { execFileSync } from 'child_process';

test('schema-snapshot.json は database.types.ts と同期している', () => {
  // 生成器を --check モードで実行(不一致なら exit 1 → throw)。
  expect(() =>
    execFileSync('node', ['scripts/gen-schema-snapshot.mjs', '--check'], {
      cwd: process.cwd(),
      stdio: 'pipe',
    }),
  ).not.toThrow();
});
