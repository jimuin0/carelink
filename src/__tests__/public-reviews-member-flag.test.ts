/**
 * @jest-environment node
 *
 * public_reviews（口コミの公開ビュー）の最新定義を機械で固定する（2026年10月22日 新設）。
 *
 * 【背景】口コミの投稿者名は、本人が入力したニックネームをそのまま公開する（神原さん決定）。
 * なりすまし対策として、アカウントからの投稿かどうかだけを真偽値 is_member で公開し、
 * 一覧に「会員」バッジを出す。user_id そのものは公開しない。
 *
 * 守るもの:
 *   1. 公開ビューの性質（security_invoker=false + security_barrier=true＝列を絞るための境界）を保つ
 *   2. user_id・reviewer_ip を列として出さない（is_member は真偽値への変換だけ）
 *   3. 既存の列は順序・型を変えず、is_member を末尾に足す（CREATE OR REPLACE VIEW の制約）
 *   4. GRANT を同じ内容で再設定し、接続先ガードを持つ
 *   5. 型（database.types.ts）とスナップショットが is_member を知っている
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const DIR = join(ROOT, 'supabase/migrations');

/** タイムスタンプ順で、public_reviews を定義する migration を古い順に返す。 */
function viewDefinitions(): { file: string; sql: string; body: string }[] {
  return readdirSync(DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(DIR, file), 'utf8') }))
    .map(({ file, sql }) => {
      const m = /CREATE OR REPLACE VIEW public\.public_reviews[\s\S]*?;/i.exec(sql);
      return m ? { file, sql, body: m[0] } : null;
    })
    .filter((d): d is { file: string; sql: string; body: string } => d !== null);
}

/** SELECT 句の列（式）を順に取り出す。 */
function selectList(body: string): string[] {
  const m = /\bSELECT\b([\s\S]*?)\bFROM\b/i.exec(body);
  if (!m) throw new Error('SELECT 句を抽出できなかった');
  return m[1].split(',').map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const defs = viewDefinitions();
const latest = defs[defs.length - 1];
const previous = defs[defs.length - 2];

test('空振りしていない（定義が複数見つかり、最新は is_member を足した migration）', () => {
  expect(defs.length).toBeGreaterThanOrEqual(2);
  expect(latest.file).toBe('20261022130000_public_reviews_is_member.sql');
});

test('公開ビューの性質（invoker=false・barrier=true）を保っている', () => {
  expect(latest.body).toMatch(/WITH \(security_invoker=false,\s*security_barrier=true\)/);
});

test('既存の列は順序どおりに残り、is_member を末尾に足している', () => {
  const before = selectList(previous.body);
  const after = selectList(latest.body);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after).toHaveLength(before.length + 1);
  expect(after[after.length - 1]).toBe('(r.user_id IS NOT NULL) AS is_member');
});

test('user_id・reviewer_ip を列として公開しない（真偽値への変換だけ）', () => {
  const cols = selectList(latest.body);
  const exposesRawUserId = cols.some((c) => /\buser_id\b/.test(c) && !/IS NOT NULL\) AS is_member$/.test(c));
  expect(exposesRawUserId).toBe(false);
  expect(cols.some((c) => /reviewer_ip/.test(c))).toBe(false);
});

test('公開条件（公開中・未フラグ・公開施設）を変えていない', () => {
  const where = (body: string) => body.slice(body.search(/\bWHERE\b/i)).replace(/\s+/g, ' ');
  expect(where(latest.body)).toBe(where(previous.body));
});

test('GRANT を同じ内容で再設定し、接続先ガードを持つ', () => {
  const sql = latest.sql.replace(/\s+/g, ' ');
  expect(sql).toContain('REVOKE ALL ON public.public_reviews FROM PUBLIC,anon,authenticated,service_role;');
  expect(sql).toContain('GRANT SELECT ON public.public_reviews TO anon,authenticated,service_role;');
  expect(latest.sql).toContain("IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'");
});

test('型とスナップショットが is_member を知っている（select("*") の結果を型で扱えるように）', () => {
  const snapshot = JSON.parse(readFileSync(join(ROOT, 'src/lib/schema-snapshot.json'), 'utf8'));
  expect(snapshot.public_reviews).toContain('is_member');
  expect(snapshot.public_reviews).not.toContain('user_id');
  const types = readFileSync(join(ROOT, 'src/types/database.types.ts'), 'utf8');
  const block = types.slice(types.indexOf('      public_reviews: {'));
  expect(block.slice(0, block.indexOf('Relationships'))).toContain('is_member: boolean | null');
});
