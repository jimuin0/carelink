#!/usr/bin/env node
/**
 * スキーマ・フィンガープリントの差分エンジン。
 *
 * 使い方:
 *   node scripts/schema-diff.mjs <expected.txt> <actual.txt> [--allow scripts/schema-drift-allow.txt]
 *   expected = shadow（migration を全適用した使い捨て DB）
 *   actual   = 本番
 *
 * 🔴 なぜ手管理スナップショットをやめたか（2026年8月2日 実測）:
 *   旧方式は src/lib/schema-constraints-snapshot.json を人が更新する前提だった。
 *   migration 20260722000005 が UNIQUE(facility_id,is_active) を意図的に DROP した際に
 *   JSON だけ取り残され、**毎日「制約欠落1」を誤報し続けていた**。
 *   期待値を migration から毎回導出すれば、この class は構造的に消える。
 *
 * 出力:
 *   missing = migration にはあるが本番に無い（＝未適用 / out-of-band 削除）
 *   extra   = 本番にあるが migration に無い（＝out-of-band 追加）
 *   どちらかがあれば exit 1。
 *
 * 除外（allow）:
 *   Supabase が管理していて migration に現れないものだけを、**理由必須**で除外する。
 *   理由が空の行は無効（「印を付ければ通る」にしない）。
 */
import { readFileSync } from 'node:fs';

const ALLOW_SEP = '##';

/** allow ファイルを読む。1 行 = `<前方一致パターン> ## <理由>`。理由が空なら無効。 */
export function parseAllow(text) {
  const rules = [];
  const invalid = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    // 🔴 `#` で始まる行は **無条件に** コメント（2026年8月2日・自分の欠陥を敵対検証で発見）。
    //   旧実装は `line.startsWith('#') && !line.includes('##')` で判定しており、
    //   書式を説明したコメント行（`# 書式: <パターン> ## <理由>`）が**実ルールとして
    //   登録されていた**。ルール 0 本のはずのファイルで 1 本が有効になっており、
    //   説明文が本物のドリフトを黙って抑止し得た。
    //   CLAUDE.md に同型（コメント中の文字列を実体と誤認）が 2 件記録されている。
    if (!line || line.startsWith('#')) continue;
    if (!line.includes(ALLOW_SEP)) {
      invalid.push({ line, why: '区切り "##" が無い（理由の記載が必須）' });
      continue;
    }
    const [patternRaw, ...reasonParts] = line.split(ALLOW_SEP);
    const pattern = patternRaw.trim();
    const reason = reasonParts.join(ALLOW_SEP).trim();
    if (!reason) { invalid.push({ line, why: '理由が空（理由の無い除外は無効）' }); continue; }
    rules.push({ pattern, reason });
  }
  return { rules, invalid };
}

/** allow にマッチするか（前方一致）。マッチした rule を返す。 */
export function matchAllow(line, rules) {
  return rules.find((r) => line.startsWith(r.pattern)) ?? null;
}

/** フィンガープリント 2 つを突合する。 */
export function diffFingerprints(expectedLines, actualLines, rules = []) {
  const norm = (arr) => new Set(arr.map((l) => l.trim()).filter(Boolean));
  const exp = norm(expectedLines);
  const act = norm(actualLines);

  const missing = [];
  const extra = [];
  const allowed = [];

  for (const l of exp) {
    if (act.has(l)) continue;
    const m = matchAllow(l, rules);
    if (m) allowed.push({ kind: 'missing', line: l, reason: m.reason });
    else missing.push(l);
  }
  for (const l of act) {
    if (exp.has(l)) continue;
    const m = matchAllow(l, rules);
    if (m) allowed.push({ kind: 'extra', line: l, reason: m.reason });
    else extra.push(l);
  }
  missing.sort();
  extra.sort();
  return { missing, extra, allowed, expectedCount: exp.size, actualCount: act.size };
}

/** 走査が空振りしていないことの下限。0 行同士は「一致」ではなく「測れていない」。 */
export function assertNotVacuous(result, minLines) {
  const problems = [];
  if (result.expectedCount < minLines) {
    problems.push(`expected 側が ${result.expectedCount} 行しかない（下限 ${minLines}）`);
  }
  if (result.actualCount < minLines) {
    problems.push(`actual 側が ${result.actualCount} 行しかない（下限 ${minLines}）`);
  }
  return problems;
}

/** JSON 配列（コミット済み期待値）とプレーンテキスト（psql 出力）の両方を受ける。 */
export function readLines(path) {
  const raw = readFileSync(path, 'utf8');
  const head = raw.trimStart();
  if (head.startsWith('[')) return JSON.parse(raw);
  return raw.split('\n');
}

function main(argv) {
  const args = argv.slice(2);
  const files = args.filter((a) => !a.startsWith('--'));
  const allowIdx = args.indexOf('--allow');
  const minIdx = args.indexOf('--min-lines');
  const minLines = minIdx >= 0 ? Number(args[minIdx + 1]) : 500;

  if (files.length < 2) {
    console.error('usage: schema-diff.mjs <expected.txt> <actual.txt> [--allow <file>] [--min-lines N]');
    return 2;
  }
  const [expPath, actPath] = files;

  let rules = [];
  if (allowIdx >= 0) {
    const { rules: r, invalid } = parseAllow(readFileSync(args[allowIdx + 1], 'utf8'));
    if (invalid.length) {
      console.error('🔴 allow ファイルに無効な行があります（理由の無い除外は認めません）:');
      for (const i of invalid) console.error(`   ${i.why}: ${i.line}`);
      return 1;
    }
    rules = r;
  }

  const expected = readLines(expPath);
  const actual = readLines(actPath);
  const result = diffFingerprints(expected, actual, rules);

  const vacuous = assertNotVacuous(result, minLines);
  if (vacuous.length) {
    console.error('🔴 走査が空振りしています（0 件一致を「正常」と読み替えない）:');
    for (const v of vacuous) console.error(`   ${v}`);
    return 1;
  }

  if (result.allowed.length) {
    console.log(`ℹ️  理由付きで除外: ${result.allowed.length} 件`);
    for (const a of result.allowed) console.log(`   [${a.kind}] ${a.line}  ← ${a.reason}`);
  }

  if (!result.missing.length && !result.extra.length) {
    console.log(`✅ スキーマ一致（migration 由来 ${result.expectedCount} 項目 / 本番 ${result.actualCount} 項目）`);
    return 0;
  }

  if (result.missing.length) {
    console.error(`\n🔴 本番に【無い】: ${result.missing.length} 件（migration 未適用 / out-of-band 削除の疑い）`);
    for (const l of result.missing) console.error(`   - ${l}`);
  }
  if (result.extra.length) {
    console.error(`\n🔴 本番に【余分】: ${result.extra.length} 件（out-of-band 追加の疑い）`);
    for (const l of result.extra) console.error(`   + ${l}`);
  }
  console.error(`\n  合計 ${result.missing.length + result.extra.length} 件のドリフト`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
