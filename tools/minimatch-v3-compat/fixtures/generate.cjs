'use strict';

// Regenerates minimatch-3.1.5.json from the original published minimatch.
// Usage: node generate.cjs <directory of minimatch@3.1.5> <recorded ESLint calls.json>
// The recorded calls come from wrapping the root minimatch during `eslint src`;
// they supply the real patterns/options and three sample paths per outcome.
const fs = require('node:fs');
const path = require('node:path');

const minimatch = require(path.resolve(process.argv[2]));
if (require(path.resolve(process.argv[2], 'package.json')).version !== '3.1.5') {
  throw new Error('Generate the fixture with the original minimatch 3.1.5');
}
const recorded = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).sort((a, b) =>
  JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);

const combos = new Map();
const paths = new Set();
const buckets = new Map();
for (const [, pattern, options, file, partial, result] of recorded) {
  combos.set(JSON.stringify([pattern, options]), [pattern, options]);
  const bucket = JSON.stringify([pattern, options, partial, result]);
  const seen = buckets.get(bucket) || 0;
  if (seen < 3) { paths.add(file); buckets.set(bucket, seen + 1); }
}

// Options used by enabled-or-available ESLint plugin call sites, and shapes
// the recorded run does not reach (negation, comments, braces, extglob, classes).
const extraPatterns = ['*', '**', '*.ts', '**/*.test.ts', '!**/*.test.ts', '#comment', 'src/**',
  '**/.*', '{src,e2e}/**/*.ts', 'src/@(app|lib)/*', 'src/lib/[a-c]*.ts', 'src/app/**/page.tsx',
  '**/node_modules/**', 'a\\*b', 'src/**/', '**/__tests__/**/*.{ts,tsx}', 'on*', 'handle*',
  'Foo*', '*Label', 'next/*', '@/components/**'];
const extraOptions = [{}, { dot: true }, { dot: true, matchBase: true }, { nocomment: true },
  { noglobstar: true }, { dot: true, flipNegate: true }];
for (const pattern of extraPatterns)
  for (const options of extraOptions) combos.set(JSON.stringify([pattern, options]), [pattern, options]);
for (const file of ['a*b', 'aXb', '.env', 'src/.hidden.ts', 'src/app/page.tsx', 'src/app/x/y/page.tsx',
  'src/lib/a.ts', 'src/lib/d.ts', 'src/lib/', 'e2e/a.spec.ts', 'node_modules/x/index.js', 'x/node_modules/y',
  'onClick', 'handleChange', 'FooBar', 'AriaLabel', 'next/link', '@/components/ui/Button', '#comment',
  'src//lib//a.ts', './src/lib/a.ts', 'src/lib/../app/page.tsx', 'SRC/LIB/A.TS', 'src\\lib\\a.ts', ''])
  paths.add(file);

const pathList = [...paths].sort();
const bits = (fn) => pathList.map((file) => (fn(file) ? '1' : '0')).join('');
const cases = [...combos.values()].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)
  .map(([pattern, options]) => {
    const matcher = new minimatch.Minimatch(pattern, options || undefined);
    return {
      pattern,
      options,
      call: bits((file) => minimatch(file, pattern, options || undefined)),
      match: bits((file) => matcher.match(file)),
      partial: bits((file) => matcher.match(file, true)),
    };
  });

fs.writeFileSync(path.join(__dirname, 'minimatch-3.1.5.json'),
  `${JSON.stringify({ generatedWith: 'minimatch@3.1.5', paths: pathList, cases }, null, 1)}\n`);
