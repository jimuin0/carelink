import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const project = process.cwd();
const adapter = path.join(project, 'tools/minimatch-v3-compat/index.cjs');
const fixture = JSON.parse(fs.readFileSync(path.join(project, 'tools/minimatch-v3-compat/fixtures/minimatch-3.1.5.json'), 'utf8'));

type Case = { pattern: string; options: Record<string, boolean> | null; call: string; match: string; partial: string };

// minimatch 11 corrected partial (directory-prefix) matching. These differ from
// 3.1.5 only for `partial` calls without `dot`, or on `./` and `..` segments.
// ESLint's only partial calls use { dot: true } on normalized relative paths
// (37,973 recorded calls replayed with no difference), and no plugin uses partial.
const knownPartialDifferences = [
  ...['**/.*'].flatMap((pattern) => [{}, { nocomment: true }, { dot: true }, { dot: true, matchBase: true }, { dot: true, flipNegate: true }]
    .flatMap((options) => ['./src/lib/a.ts', 'src/lib/../app/page.tsx'].map((file) => [pattern, options, file, false]))),
  ...[{}, { nocomment: true }].flatMap((options) => ['.env', 'src/.hidden.ts'].flatMap((file) => [
    ['**/.*', options, file, true],
    ['**/__tests__/**/*.{ts,tsx}', options, file, false],
    ['**/node_modules/**', options, file, false],
  ])),
];

describe('ESLint minimatch 3 adapter', () => {
  it('serves every minimatch 3 consumer, and nothing else installs a minimatch below 11.0.1', () => {
    const consumers = ['eslint', '@eslint/config-array', '@eslint/eslintrc',
      ...['eslint-plugin-import', 'eslint-plugin-jsx-a11y', 'eslint-plugin-react'].map((name) => `eslint-config-next/node_modules/${name}`)]
      .map((name) => path.join(project, 'node_modules', name));
    for (const dir of consumers) {
      expect([dir, JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies.minimatch]).toEqual([dir, expect.stringMatching(/^\^3\./)]);
      expect(fs.realpathSync(require.resolve('minimatch', { paths: [dir] }))).toBe(adapter);
    }

    const lock = JSON.parse(fs.readFileSync(path.join(project, 'package-lock.json'), 'utf8')).packages;
    const installed = Object.entries(lock as Record<string, { version?: string; resolved?: string; link?: boolean }>)
      .filter(([key]) => /(^|\/)node_modules\/minimatch(-v11)?$/.test(key));
    expect(installed.length).toBeGreaterThan(3);
    for (const [key, entry] of installed) {
      if (entry.link) {
        expect([key, entry.resolved]).toEqual(['node_modules/minimatch', 'tools/minimatch-v3-compat']);
      } else {
        const [major, minor, patch] = String(entry.version).split('.').map(Number);
        expect([key, major > 11 || (major === 11 && (minor > 0 || patch >= 1))]).toEqual([key, true]);
      }
    }
  });

  it('reproduces minimatch 3.1.5 for the recorded ESLint patterns, plugin options and edge shapes', () => {
    const minimatch = require(adapter);
    expect(fixture.generatedWith).toBe('minimatch@3.1.5');
    expect(fixture.cases.length).toBeGreaterThan(150);
    const differences: unknown[] = [];
    let compared = 0;
    for (const { pattern, options, call, match, partial } of fixture.cases as Case[]) {
      const matcher = new minimatch.Minimatch(pattern, options || undefined);
      fixture.paths.forEach((file: string, i: number) => {
        compared += 1;
        expect([pattern, options, file, minimatch(file, pattern, options || undefined), matcher.match(file)])
          .toEqual([pattern, options, file, call[i] === '1', match[i] === '1']);
        const result = matcher.match(file, true);
        if (result !== (partial[i] === '1')) differences.push([pattern, options || {}, file, result]);
      });
    }
    expect(compared).toBeGreaterThan(9000);
    const sorted = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).sort();
    expect(sorted(differences)).toEqual(sorted(knownPartialDifferences));
  });

  it('keeps the minimatch 3 call shape on patched minimatch 11 and fails loudly for makeRe', () => {
    const minimatch = require(adapter);
    const v11 = require(require.resolve('minimatch-v11', { paths: [path.dirname(adapter)] }));
    expect(require(require.resolve('minimatch-v11/package.json', { paths: [path.dirname(adapter)] })).version).toBe('11.0.3');
    expect(typeof minimatch).toBe('function');
    for (const name of ['Minimatch', 'GLOBSTAR', 'sep', 'filter', 'match', 'braceExpand', 'defaults', 'escape', 'unescape'])
      expect([name, minimatch[name]]).toEqual([name, v11.minimatch[name]]);
    expect(() => minimatch.makeRe('src/**')).toThrow('review tools/minimatch-v3-compat');
  });

  it('does not enable the only plugin rule that needs makeRe', () => {
    const script = `import('eslint').then(async ({ ESLint }) => {
      const eslint = new ESLint();
      const files = ['src/app/page.tsx', 'src/lib/safe.ts', 'src/app/admin/page.tsx', 'src/__tests__/minimatch-v3-adapter.test.ts'];
      const rules = await Promise.all(files.map(async (file) => (await eslint.calculateConfigForFile(file)).rules || {}));
      console.log(JSON.stringify(rules.map((r) => [Object.keys(r).length, r['import/no-internal-modules'] || null])));
    });`;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: project, encoding: 'utf8' }));
    expect(result).toHaveLength(4);
    for (const [count, rule] of result) {
      expect(count).toBeGreaterThan(50);
      expect(rule === null || rule[0] === 0 || rule[0] === 'off').toBe(true);
    }
  });
});
