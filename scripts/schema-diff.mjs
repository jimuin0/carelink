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
 *
 * 🔴 差分を数える【前】に、そもそも突合が成立しているかを 3 つ検査する（2026年8月3日）。
 *   src/lib/schema-drift.ts の diffFingerprint と**同じ順序・同じしきい値**であること。
 *   engine が 2 本あって安全側の挙動が食い違う状態そのものが欠陥なので、
 *   src/lib/__tests__/schema-diff-allow.test.ts が両者の一致を機械で強制する。
 *     1. 空振り（どちらかが極端に少ない）
 *     2. 別 DB（リレーション名の重なりが低い）
 *     3. PostgreSQL メジャーバージョン不一致（pg_get_* の整形差がノイズになる）
 *   いずれも「本番のドリフト」ではなく「比較が成立していない」なので、
 *   差分を 1 件も主張してはいけない。実際、2 を入れる前に CareLink の期待値を
 *   soel の本番と突合して「RLS が 90 本欠落」という存在しない事故を報告しかけた。
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

/** 「同じ DB を見ているか」の判定しきい値（リレーション名の重なり率）。 */
export const SAME_DATABASE_MIN_OVERLAP = 0.5;

/** フィンガープリント内の PostgreSQL メジャーバージョン行の接頭辞。 */
export const VERSION_LINE_PREFIX = 'meta|server_version_major|';

/** `relation|<name>|...` からリレーション名だけを取り出す。 */
export function relationNames(lines) {
  const out = new Set();
  for (const l of lines) {
    if (!l.startsWith('relation|')) continue;
    out.add(l.split('|')[1]);
  }
  out.delete('');
  return out;
}

/** `meta|server_version_major|<n>` の値。行が無ければ null。昇順で最初の 1 件を採る。 */
export function versionMajor(lines) {
  const hits = [];
  for (const l of lines) {
    if (l.startsWith(VERSION_LINE_PREFIX)) hits.push(l.slice(VERSION_LINE_PREFIX.length));
  }
  hits.sort();
  return hits.length > 0 ? hits[0] : null;
}

/**
 * 突合が成立しているかを検査する。成立していなければ理由文字列、していなければ null。
 * 順序は src/lib/schema-drift.ts の diffFingerprint と同じ（空振り → 別 DB → バージョン）。
 */
export function comparabilityProblem(exp, act, minLines) {
  if (exp.size < minLines || act.size < minLines) {
    return `走査が空振り（expected ${exp.size} 行 / actual ${act.size} 行・下限 ${minLines}）`;
  }
  const expRels = relationNames(exp);
  const actRels = relationNames(act);
  const denom = Math.min(expRels.size, actRels.size);
  if (denom > 0) {
    let shared = 0;
    for (const r of actRels) if (expRels.has(r)) shared += 1;
    const overlap = shared / denom;
    if (overlap < SAME_DATABASE_MIN_OVERLAP) {
      return `別のデータベースと突合している疑い（テーブル名の重なり ${(overlap * 100).toFixed(0)}%`
        + ` / expected ${expRels.size} 表・actual ${actRels.size} 表）`;
    }
  }
  const expVer = versionMajor(exp);
  const actVer = versionMajor(act);
  if (expVer !== actVer) {
    return `PostgreSQL メジャーバージョン不一致（expected=${expVer ?? '不明'} / actual=${actVer ?? '不明'}）`;
  }
  return null;
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

  // 🔴 差分を出力する【前】に、突合が成立しているかを見る。成立していないのに
  //   missing/extra を出すと「存在しない事故」の報告になる。
  const norm = (arr) => new Set(arr.map((l) => String(l ?? '').trim()).filter(Boolean));
  const problem = comparabilityProblem(norm(expected), norm(actual), minLines);
  if (problem) {
    console.error('🔴 突合が成立していません（差分は 1 件も主張しません）:');
    console.error(`   ${problem}`);
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
