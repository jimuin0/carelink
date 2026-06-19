#!/usr/bin/env node
/**
 * database.types.ts から「public スキーマの各テーブル/ビューの列名」を抽出し、
 * src/lib/schema-snapshot.json に書き出す生成器。
 *
 * このスナップショットは /api/cron/schema-drift-check が本番スキーマ(RPC get_public_columns)と
 * 突合する「期待スキーマ」。database.types.ts を唯一の真実源とし、ズレを発症前検知する。
 *
 * 同期保証: src/lib/__tests__/schema-snapshot.test.ts が本生成器の出力と
 * コミット済み JSON の一致を検証する(types を変えて JSON 再生成を忘れると CI が落ちる)。
 *
 * 使い方: node scripts/gen-schema-snapshot.mjs   (--check で差分検出のみ・書き込みなし)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TYPES = join(__dirname, '..', 'src', 'types', 'database.types.ts');
const OUT = join(__dirname, '..', 'src', 'lib', 'schema-snapshot.json');

/**
 * public スキーマの Tables/Views の Row 列名を {table: [sorted cols]} で返す。
 * Functions(Row 無し)・graphql_public(Tables 空)は自然に除外される。
 */
export function buildSnapshot(src) {
  const lines = src.split('\n');
  const out = {};
  let cur = null;
  let inRow = false;
  for (const line of lines) {
    const t = line.match(/^ {6}([a-z_][a-z0-9_]*): \{$/);
    if (t && !inRow) {
      cur = t[1];
      continue;
    }
    if (cur && /^ {8}Row: \{$/.test(line)) {
      inRow = true;
      out[cur] = [];
      continue;
    }
    if (inRow) {
      const c = line.match(/^ {10}([a-z_][a-z0-9_]*)\??: /);
      if (c) out[cur].push(c[1]);
      else if (/^ {8}\}/.test(line)) {
        inRow = false;
        cur = null;
      }
    }
  }
  const sorted = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k].slice().sort();
  return sorted;
}

const snapshot = buildSnapshot(readFileSync(TYPES, 'utf8'));
const json = JSON.stringify(snapshot, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const existing = readFileSync(OUT, 'utf8');
  if (existing !== json) {
    console.error('schema-snapshot.json が database.types.ts と不一致です。`node scripts/gen-schema-snapshot.mjs` を実行してください。');
    process.exit(1);
  }
  console.log('schema-snapshot.json は最新です。');
} else {
  writeFileSync(OUT, json);
  console.log(`生成完了: ${Object.keys(snapshot).length} テーブル/ビュー → ${OUT}`);
}
