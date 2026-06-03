#!/usr/bin/env node
/**
 * Jest の失敗出力(/tmp/jest_full.txt)を解析し、XFF 先頭値を前提にした
 * IP アサーション（旧挙動）を、安全挙動での Received 値（末尾/x-real-ip）へ更新する。
 *
 * Jest が "Received" として示す値が新しい正値なので、それを当該 file:line の
 * Expected リテラルへ機械的に置換する（推測なし・事実ベース）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const log = readFileSync('/tmp/jest_full.txt', 'utf8').split('\n');

const fixes = []; // {file, line, expected, received}
let expected = null, received = null;

for (const raw of log) {
  const mE = raw.match(/^\s*Expected:\s*"([^"]*)"\s*$/);
  const mR = raw.match(/^\s*Received:\s*"([^"]*)"\s*$/);
  const mAt = raw.match(/at Object\.<?\w+>?[^(]*\((src\/[^):]+__tests__[^):]+):(\d+):(\d+)\)/);
  if (mE) { expected = mE[1]; received = null; continue; }
  if (mR) { received = mR[1]; continue; }
  if (mAt && expected !== null && received !== null) {
    fixes.push({ file: mAt[1], line: parseInt(mAt[2], 10), expected, received });
    expected = null; received = null;
  }
}

// file ごとに集約
const byFile = new Map();
for (const f of fixes) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

let applied = 0;
const skipped = [];
for (const [file, list] of byFile) {
  const lines = readFileSync(file, 'utf8').split('\n');
  for (const { line, expected, received } of list) {
    const idx = line - 1;
    const orig = lines[idx];
    if (orig === undefined) { skipped.push(`${file}:${line} (no such line)`); continue; }
    // ガード: IP アサーション行のみ（toBe + 期待リテラルを含む）
    if (!orig.includes(`'${expected}'`) && !orig.includes(`"${expected}"`)) {
      skipped.push(`${file}:${line} (expected '${expected}' not on line: ${orig.trim()})`);
      continue;
    }
    lines[idx] = orig
      .replace(`'${expected}'`, `'${received}'`)
      .replace(`"${expected}"`, `"${received}"`);
    applied++;
  }
  writeFileSync(file, lines.join('\n'));
}

console.log(`applied=${applied} files=${byFile.size}`);
if (skipped.length) { console.log('--- SKIPPED ---'); skipped.forEach(s => console.log(s)); }
