/**
 * @jest-environment node
 *
 * 店舗に口コミ投稿者の IP アドレス・アカウント ID を渡さない（2026年10月23日・migration 20261023120100）。
 *
 * 【背景】facility_reviews は authenticated にテーブル単位の SELECT があり、RLS（自店の owner / admin なら全行）は
 * 列を絞れない。店舗は /admin/reviews（select('*')）や PostgREST の直接呼び出しで全投稿者の reviewer_ip・user_id を
 * 受け取れ、user_id を自店の予約と突き合わせてニックネームの投稿者を特定できた。
 *
 * 列単位の GRANT は schema-fingerprint に記録されないので、ここで migration を適用順に読み、
 * 最終状態で anon / authenticated が本人確認に使える列を読めないことを固定する。
 * 実 DB での確認は supabase/shadow/review-identity-columns-fixtures.sql（CI の使い捨て PG17）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const DIR = join(ROOT, 'supabase/migrations');
const MIGRATION = '20261023120100_review_reviewer_identity_column_grants.sql';
const IDENTITY_COLUMNS = ['reviewer_ip', 'user_id', 'booking_id', 'client_operation_id'];
// 2026年10月23日レビュー指摘: flag_reason には flag-reviews cron の「同じ IP から投稿された」判定
// （投稿者どうしの結び付けの手がかり）と運営の内部メモが入る。IP を隠しても結び付けが店舗に渡るので外す。
const WITHHELD_COLUMNS = [...IDENTITY_COLUMNS, 'flag_reason'];
const ROLES = ['anon', 'authenticated'] as const;
/** コメントを除き空白を 1 つに潰した SQL（説明文の中の語に反応しない）。 */
const code = (text: string) => text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

type Access = { table: boolean; columns: Set<string> };

/** カンマ区切りの権限一覧を、括弧内（列リスト）のカンマで切らずに分ける。 */
function privileges(list: string): { name: string; columns: string[] | null }[] {
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { items.push(current); current = ''; } else current += ch;
  }
  items.push(current);
  return items.map((item) => {
    const m = /^\s*([A-Za-z ]+?)\s*(?:\(([^)]*)\))?\s*$/.exec(item)!;
    return { name: m[1].toUpperCase(), columns: m[2] ? m[2].split(',').map((c) => c.trim()) : null };
  });
}

/** migration を順に適用し、facility_reviews の SELECT 権限の最終状態を返す。 */
function selectAccess(files: string[]): Record<(typeof ROLES)[number], Access> {
  const state = { anon: { table: false, columns: new Set<string>() }, authenticated: { table: false, columns: new Set<string>() } };
  const statement = /\b(GRANT|REVOKE)\s+([^;]*?)\s+ON\s+(?:TABLE\s+)?((?:public\.)?"?facility_reviews"?(?![\w(])|ALL TABLES IN SCHEMA public)\s+(?:TO|FROM)\s+([^;]+);/gi;
  for (const file of files) {
    for (const m of code(readFileSync(join(DIR, file), 'utf8')).matchAll(statement)) {
      const roles = ROLES.filter((role) => new RegExp(`\\b${role}\\b`).test(m[4]));
      for (const privilege of privileges(m[2])) {
        if (privilege.name !== 'SELECT' && !privilege.name.startsWith('ALL')) continue;
        for (const role of roles) {
          if (m[1].toUpperCase() === 'REVOKE') { state[role].table = false; state[role].columns.clear(); }
          else if (privilege.columns) privilege.columns.forEach((c) => state[role].columns.add(c));
          else state[role].table = true;
        }
      }
    }
  }
  return state;
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

test('走査は空振りしていない（移行前は authenticated にテーブル単位の SELECT が付いていた）', () => {
  expect(selectAccess(files.filter((f) => f < MIGRATION)).authenticated.table).toBe(true);
});

test.each(ROLES)('最終状態で %s は本人確認に使える列を読めない（テーブル単位の SELECT も無い）', (role) => {
  const access = selectAccess(files)[role];
  expect(access.table).toBe(false);
  for (const column of WITHHELD_COLUMNS) expect(access.columns.has(column)).toBe(false);
});

test('付け直した列は実在し、店舗の一覧と公開・非表示の切り替えに要る列を含む', () => {
  const columns = [...selectAccess(files).authenticated.columns];
  const snapshot: string[] = JSON.parse(readFileSync(join(ROOT, 'src/lib/schema-snapshot.json'), 'utf8')).facility_reviews;
  expect(columns.filter((c) => !snapshot.includes(c))).toEqual([]);
  for (const needed of ['id', 'facility_id', 'reviewer_name', 'rating', 'comment', 'status', 'is_flagged', 'created_at']) {
    expect(columns).toContain(needed);
  }
  // 本人確認の列以外はすべて付け直している（読めなくなる列を増やして画面を壊さない）
  expect(snapshot.filter((c) => !columns.includes(c)).sort()).toEqual([...WITHHELD_COLUMNS].sort());
});

test('migration は接続先ガードで始まり、デプロイ後に適用すると明記している', () => {
  const raw = readFileSync(join(DIR, MIGRATION), 'utf8');
  expect(code(raw).trim()).toMatch(/^DO \$guard\$ BEGIN IF to_regclass\('public\.facility_profiles'\) IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END \$guard\$;/);
  expect(raw).toContain('適用順: アプリのデプロイ【後】');
  // 先に適用したときに壊れるのはマイページだけではない（旧 /admin/reviews も select('*')）
  expect(raw).toContain('/admin/reviews');
});

test('ブラウザで動く画面は facility_reviews を読まない（status の更新だけ）', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { if (entry !== '__tests__' && entry !== 'api') walk(path); continue; }
      if (!/\.tsx?$/.test(entry)) continue;
      const src = readFileSync(path, 'utf8');
      if (!/^['"]use client['"]/m.test(src)) continue;
      for (const m of src.matchAll(/\.from\(\s*'facility_reviews'\s*\)([\s\S]{0,80})/g)) {
        if (!/^\s*\.update\(\{\s*status\b/.test(m[1])) offenders.push(relative(ROOT, path));
      }
    }
  };
  walk(join(ROOT, 'src'));
  expect(offenders).toEqual([]);
});

test('実 DB での確認（shadow fixture）が CI に配線されている', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  expect(workflow).toContain('-f supabase/shadow/review-identity-columns-fixtures.sql');
  const fixture = readFileSync(join(ROOT, 'supabase/shadow/review-identity-columns-fixtures.sql'), 'utf8');
  for (const column of WITHHELD_COLUMNS) expect(fixture).toContain(`'SELECT ${column} FROM public.facility_reviews'`);
});
