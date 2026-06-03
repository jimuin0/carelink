#!/usr/bin/env node
/**
 * M3 真の根本原因修正: inline XFF 先頭値（クライアント詐称可能）を
 * 中央集約ヘルパー getClientIp(request)（x-real-ip 優先・XFF 末尾）へ置換する。
 *
 * 対象: src/app/api/** の本番ルート（__tests__ / lib 除く）。
 * 全対象は既に '@/lib/rate-limit' を import 済みであることを前提に、
 * named import へ getClientIp を追加する。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync(
  `grep -rl "x-forwarded-for" src --include="*.ts" --include="*.tsx" | grep -v "__tests__" | grep -v "/lib/"`,
  { encoding: 'utf8' }
).trim().split('\n').filter(Boolean);

// <var>.headers.get('x-forwarded-for')?.split(',')[0] (|| | ??) ('unknown' | null)
const INLINE = /(\w+)\.headers\.get\((['"])x-forwarded-for\2\)\?\.split\((['"]),\3\)\[0\]\s*(?:\|\||\?\?)\s*(?:(['"])unknown\4|null)/g;

let changedFiles = 0;
let changedSites = 0;
const skipped = [];

for (const file of files) {
  let src = readFileSync(file, 'utf8');
  const before = src;

  // 1) inline 式置換
  src = src.replace(INLINE, (_m, v) => `getClientIp(${v})`);
  const sites = (before.match(INLINE) || []).length;

  if (src === before) {
    skipped.push(`${file} (no inline match)`);
    continue;
  }

  // 2) import に getClientIp 追加（既存の '@/lib/rate-limit' named import を利用）
  if (!/getClientIp/.test(src.split('\n').filter(l => /@\/lib\/rate-limit/.test(l)).join('\n'))) {
    const importRe = /import\s*\{([^}]*)\}\s*from\s*(['"])@\/lib\/rate-limit\2/;
    const m = src.match(importRe);
    if (!m) {
      skipped.push(`${file} (NO rate-limit named import found!)`);
      continue;
    }
    const names = m[1];
    const newNames = names.trimEnd().endsWith(',')
      ? `${names} getClientIp, `
      : `${names.trim()}, getClientIp `;
    src = src.replace(importRe, `import {${newNames}} from ${m[2]}@/lib/rate-limit${m[2]}`);
  }

  writeFileSync(file, src);
  changedFiles++;
  changedSites += sites;
}

console.log(`changedFiles=${changedFiles} changedSites=${changedSites}`);
if (skipped.length) {
  console.log('--- SKIPPED ---');
  skipped.forEach(s => console.log(s));
}
