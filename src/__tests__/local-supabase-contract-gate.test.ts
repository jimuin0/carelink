/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(__dirname, '../..');
const script = join(root, 'scripts/check-local-supabase-contract.mjs');
const configured = {
  STAGING_SUPABASE_URL: 'http://127.0.0.1:54321',
  STAGING_SUPABASE_ANON_KEY: 'fixture-anon',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
};
const run = (args: string[], env = configured) => spawnSync(process.execPath, [script, ...args], {
  env, encoding: 'utf8',
});

describe('isolated Supabase contract gate', () => {
  test.each(['http://127.0.0.1:54321', 'http://localhost:54321/', 'http://[::1]:54321'])('accepts local endpoint %s', (url) => {
    expect(run(['environment'], { ...configured, STAGING_SUPABASE_URL: url }).status).toBe(0);
  });
  test.each(['', 'https://project.supabase.co', 'http://127.0.0.1.example.com:54321', 'http://localhost:54321@remote.test', 'http://localhost:54321/path', 'http://localhost:99999'])('rejects nonlocal/malformed endpoint %s', (url) => {
    expect(run(['environment'], { ...configured, STAGING_SUPABASE_URL: url }).status).toBe(1);
  });
  test.each(['STAGING_SUPABASE_ANON_KEY', 'STAGING_SUPABASE_SERVICE_ROLE_KEY'])('requires %s without printing credential values', (key) => {
    const result = run(['environment'], { ...configured, [key]: '' });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain('fixture-');
  });

  const successful = () => ({
    success: true, numTotalTestSuites: 2, numPassedTestSuites: 2, numPendingTestSuites: 0,
    numFailedTestSuites: 0, numTotalTests: 16, numPassedTests: 16,
    numPendingTests: 0, numTodoTests: 0, numFailedTests: 0,
    testResults: ['schema-invariants.contract.test.ts', 'supabase-contract.test.ts'].map((name) => ({
      name: `/isolated/tests/contract/${name}`, status: 'passed', assertionResults: [{ status: 'passed' }],
    })),
  });
  test.each(['success', 'numPendingTests', 'numTodoTests', 'numPendingTestSuites', 'numFailedTests', 'numFailedTestSuites', 'numPassedTests', 'numPassedTestSuites', 'numTotalTestSuites', 'numTotalTests', 'suiteName', 'suiteStatus', 'testStatus', 'emptySuite', 'malformed', 'pass'])('validates actual execution %s', (change) => {
    const directory = mkdtempSync(join(tmpdir(), 'carelink-contract-gate-'));
    const report = join(directory, 'report.json');
    try {
      const result = successful();
      if (change === 'success') result.success = false;
      else if (change === 'suiteName') result.testResults[0].name = 'unrelated.test.ts';
      else if (change === 'suiteStatus') result.testResults[0].status = 'pending';
      else if (change === 'testStatus') result.testResults[0].assertionResults[0].status = 'pending';
      else if (change === 'emptySuite') result.testResults[0].assertionResults = [];
      else if (change !== 'pass' && change !== 'malformed') (result as Record<string, unknown>)[change] = 1;
      writeFileSync(report, change === 'malformed' ? '{' : JSON.stringify(result));
      expect(run(['results', report]).status).toBe(change === 'pass' ? 0 : 1);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  test('workflow runs only the two real API suites after local export with all local credentials and both gates', () => {
    const yaml = require('js-yaml');
    const workflow = yaml.load(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'));
    const steps = workflow.jobs['e2e-test'].steps;
    const index = steps.findIndex((step: { name?: string }) => step.name === 'Local Supabase API contracts (no skips)');
    expect(index).toBeGreaterThan(steps.findIndex((step: { id?: string }) => step.id === 'supabase'));
    const step = steps[index];
    expect(step.if).toBeUndefined();
    expect(step['continue-on-error']).toBeUndefined();
    expect(step.env).toEqual({
      STAGING_SUPABASE_URL: '${{ steps.supabase.outputs.url }}',
      STAGING_SUPABASE_ANON_KEY: '${{ steps.supabase.outputs.anon }}',
      STAGING_SUPABASE_SERVICE_ROLE_KEY: '${{ steps.supabase.outputs.service_role }}',
    });
    expect(step.run).toMatch(/check-local-supabase-contract\.mjs environment/);
    expect(step.run).toMatch(/--runTestsByPath tests\/contract\/schema-invariants\.contract\.test\.ts tests\/contract\/supabase-contract\.test\.ts --json/);
    expect(step.run).toMatch(/check-local-supabase-contract\.mjs results/);
    expect(step.run).not.toMatch(/\|\| true|continue-on-error|--passWithNoTests/);
  });
});
