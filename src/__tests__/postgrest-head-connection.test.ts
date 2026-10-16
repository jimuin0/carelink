/** @jest-environment node */
import { spawnSync } from 'child_process';
import path from 'path';

test('real local socket fixtures detect a silent HEAD close without hiding failed backends', () => {
  const result = spawnSync('python3', [path.join(process.cwd(), 'scripts/check-local-postgrest-head.test.py')], {
    encoding: 'utf8', timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toContain('Ran 4 tests');
});
