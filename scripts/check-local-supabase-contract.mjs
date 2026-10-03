// CIの使い捨てSupabase専用。外部staging/本番の検証証拠には使わない。
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

try {
  if (process.argv[2] === 'environment') {
    const value = process.env.STAGING_SUPABASE_URL;
    if (!value || !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/?$/.test(value)) {
      throw new Error('isolated local Supabase URL required');
    }
    // Syntax/port validity as well as the explicit loopback allowlist.
    new URL(value);
    for (const key of ['STAGING_SUPABASE_ANON_KEY', 'STAGING_SUPABASE_SERVICE_ROLE_KEY']) {
      if (!process.env[key]?.trim()) throw new Error('local Supabase credentials required');
    }
  } else if (['results', 'read-results'].includes(process.argv[2])) {
    const result = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    const readOnly = process.argv[2] === 'read-results';
    const expected = readOnly ? ['schema-invariants.contract.test.ts', 'supabase-contract.test.ts'] : ['local-mutation.contract.test.ts', 'schema-invariants.contract.test.ts', 'supabase-contract.test.ts'];
    const expectedTests = readOnly ? 12 : 17;
    const names = result.testResults?.map((suite) => basename(suite.name)).sort();
    if (
      !result.success || result.numTotalTestSuites !== expected.length || result.numPassedTestSuites !== expected.length ||
      result.numPendingTestSuites !== 0 || result.numFailedTestSuites !== 0 ||
      result.numPendingTests !== 0 || result.numTodoTests !== 0 || result.numFailedTests !== 0 ||
      result.numTotalTests !== expectedTests || result.numPassedTests !== result.numTotalTests ||
      JSON.stringify(names) !== JSON.stringify(expected) ||
      !result.testResults.every((suite) => suite.status === 'passed' && suite.assertionResults.length > 0 &&
        suite.assertionResults.every((test) => test.status === 'passed'))
    ) throw new Error('all three local Supabase suites must pass without skipped tests');
  } else {
    throw new Error('expected environment or results check');
  }
  console.log(process.argv[2] === 'read-results' ? 'Configured read contract gate passed (execution target must be recorded separately).' : 'Local Supabase contract gate passed (not hosted staging/production evidence).');
} catch {
  // Never print supplied URLs, credentials, result bodies, or arbitrary exception messages.
  console.error('Local Supabase contract gate failed; verify isolated inputs and zero-skip results.');
  process.exitCode = 1;
}
