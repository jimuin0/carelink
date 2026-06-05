#!/usr/bin/env node
/**
 * getClientIp を '@/lib/rate-limit' から '@/lib/client-ip' へ import 元を切替える。
 * rate-limit をモックするテストが getClientIp を巻き込まないようにするため。
 *
 * 各対象ファイルで:
 *  1. '@/lib/rate-limit' の named import から getClientIp トークンを除去
 *  2. その import 行の直後に `import { getClientIp } from '@/lib/client-ip';` を追加
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync(
  `grep -rl "getClientIp" src --include="*.ts" --include="*.tsx" | grep -v "__tests__" | grep -v "/lib/client-ip" | grep -v "/lib/rate-limit"`,
  { encoding: 'utf8' }
).trim().split('\n').filter(Boolean);

let changed = 0;
const skipped = [];

for (const file of files) {
  let src = readFileSync(file, 'utf8');
  const before = src;

  // 1) rate-limit import 行から getClientIp を除去
  const rlImportRe = /import\s*\{([^}]*)\}\s*from\s*(['"])@\/lib\/rate-limit\2\s*;?/;
  const m = src.match(rlImportRe);
  if (!m) {
    // rate-limit から import していないが getClientIp は使っている → 既に client-ip 経由か別経路
    if (/from\s*['"]@\/lib\/client-ip['"]/.test(src)) { continue; }
    skipped.push(`${file} (no rate-limit import, no client-ip import)`);
    continue;
  }
  const quote = m[2];
  const names = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== 'getClientIp');
  const newImportLine = `import { ${names.join(', ')} } from ${quote}@/lib/rate-limit${quote};`;

  // client-ip import を rate-limit import の直後に挿入
  const clientIpImport = `\nimport { getClientIp } from ${quote}@/lib/client-ip${quote};`;
  src = src.replace(rlImportRe, newImportLine + clientIpImport);

  if (src === before) { skipped.push(`${file} (no change)`); continue; }
  writeFileSync(file, src);
  changed++;
}

console.log(`changed=${changed}`);
if (skipped.length) {
  console.log('--- SKIPPED ---');
  skipped.forEach((s) => console.log(s));
}
