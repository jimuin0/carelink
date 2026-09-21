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
  } else if (process.argv[2] === 'results') {
    const result = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    const expected = ['schema-invariants.contract.test.ts', 'supabase-contract.test.ts'];
    const names = result.testResults?.map((suite) => basename(suite.name)).sort();
    if (
      !result.success || result.numTotalTestSuites !== 2 || result.numPassedTestSuites !== 2 ||
      result.numPendingTestSuites !== 0 || result.numFailedTestSuites !== 0 ||
      result.numPendingTests !== 0 || result.numTodoTests !== 0 || result.numFailedTests !== 0 ||
      !(result.numTotalTests > 0) || result.numPassedTests !== result.numTotalTests ||
      JSON.stringify(names) !== JSON.stringify(expected) ||
      !result.testResults.every((suite) => suite.status === 'passed' && suite.assertionResults.length > 0 &&
        suite.assertionResults.every((test) => test.status === 'passed'))
    ) throw new Error('both local Supabase suites must pass without skipped tests');
  } else {
    throw new Error('expected environment or results check');
  }
  console.log('Local Supabase contract gate passed (not hosted staging/production evidence).');
} catch {
  // Never print supplied URLs, credentials, result bodies, or arbitrary exception messages.
  console.error('Local Supabase contract gate failed; verify isolated inputs and zero-skip results.');
  process.exitCode = 1;
}
