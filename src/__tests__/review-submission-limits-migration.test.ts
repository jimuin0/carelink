/**
 * @jest-environment node
 *
 * 口コミの投稿・編集の DB 側（2026年10月23日・migration 20261023120000）を機械で固定する。
 *  1. lock_review_submission … 24 時間の重複を IP に加えてアカウント（user_id）でも数える。
 *     以前は IP だけで、回線を切り替えるだけで同じアカウントから「来店確認済み」の口コミを重ねられた。
 *     抑えるのは「同じアカウント・同じ施設で 24 時間あたり 1 件」まで（1 予約 1 件のバッジは扱わない）。
 *  2. edit_review_atomic … 本文が変わっていない編集は保存済みの審査結果（is_flagged / flag_reason）を残す。
 *     以前は星だけの編集で承認済みの口コミが審査待ちにも載らないまま非公開・集計外になった。
 *  3. client_operation_id … 送り直しを 1 件の口コミにまとめる一意の操作 ID。
 * 関数を置き換える migration は直前の最終定義の写しであること（変えた箇所以外が同じこと）も確かめる。
 * 実 DB での確認は supabase/shadow/review-edit-account-limit-fixtures.sql と
 * scripts/check-review-atomic-concurrency.mjs（CI の使い捨て PG17）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIR = join(ROOT, 'supabase/migrations');
const MIGRATION = '20261023120000_review_operation_id_account_limit_star_edit.sql';
const GRANTS = '20261023120100_review_reviewer_identity_column_grants.sql';
const code = (text: string) => text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

/** 関数の定義（CREATE [OR REPLACE] FUNCTION … $$ … $$;）を古い順に返す。 */
function definitions(name: string): { file: string; body: string }[] {
  const pattern = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`, 'g');
  return files.flatMap((file) => [...readFileSync(join(DIR, file), 'utf8').matchAll(pattern)].map((m) => ({ file, body: m[0] })));
}

const sql = readFileSync(join(DIR, MIGRATION), 'utf8');

test('接続先ガードで始まり、デプロイ前に適用すると明記し、列権限の migration（デプロイ後）より前に並ぶ', () => {
  expect(code(sql)).toMatch(/^DO \$guard\$ BEGIN IF to_regclass\('public\.facility_profiles'\) IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END \$guard\$;/);
  expect(sql).toContain('適用順: アプリのデプロイ【前】');
  // 先に適用した間の旧フォームの挙動（429 に not-started が付かず投稿欄が止まる）を隠さない
  expect(sql).toContain('X-CareLink-Review-Commit: not-started が付かず');
  expect(sql).toContain('24 時間あたり 1 件');
  expect(MIGRATION < GRANTS).toBe(true);
});

describe('lock_review_submission', () => {
  const defs = definitions('lock_review_submission');
  const latest = defs[defs.length - 1];
  const previous = defs[defs.length - 2];

  test('最新の定義はこの migration で、ログイン中はアカウントでも重複を数える', () => {
    expect(latest.file).toBe(MIGRATION);
    expect(code(latest.body)).toContain('OR (NEW.user_id IS NOT NULL AND r.user_id=NEW.user_id)');
    expect(code(latest.body)).toContain("(nullif(NEW.reviewer_ip,'') IS NOT NULL AND r.reviewer_ip=NEW.reviewer_ip)");
    expect(code(previous.body)).not.toContain('r.user_id=NEW.user_id');
  });

  test('ロックの順序・例外名・SECURITY INVOKER・search_path は直前の定義と同じ', () => {
    for (const fragment of [
      "LANGUAGE plpgsql SECURITY INVOKER SET search_path=''",
      'IF NEW.user_id IS NOT NULL THEN PERFORM public.lock_booking_account(NEW.user_id); END IF; PERFORM 1 FROM public.facility_profiles WHERE id=NEW.facility_id FOR UPDATE;',
      "RAISE EXCEPTION 'REVIEW_FACILITY_UNAVAILABLE'",
      "RAISE EXCEPTION 'REVIEW_RECENT_DUPLICATE'",
    ]) {
      expect(code(previous.body)).toContain(fragment);
      expect(code(latest.body)).toContain(fragment);
    }
    expect(code(sql)).toContain('REVOKE ALL ON FUNCTION public.lock_review_submission() FROM PUBLIC, anon, authenticated;');
  });
});

describe('edit_review_atomic', () => {
  const defs = definitions('edit_review_atomic');
  const latest = defs[defs.length - 1];
  const previous = defs[defs.length - 2];
  const keep = 'is_flagged=CASE WHEN n.comment IS NOT DISTINCT FROM r.comment THEN r.is_flagged ELSE n.is_flagged END';
  const keepReason = 'flag_reason=CASE WHEN n.comment IS NOT DISTINCT FROM r.comment THEN r.flag_reason ELSE n.flag_reason END';

  test('本文が同じなら保存済みの審査結果を残す', () => {
    expect(latest.file).toBe(MIGRATION);
    expect(code(latest.body)).toContain(keep);
    expect(code(latest.body)).toContain(keepReason);
  });

  test('変えたのは is_flagged / flag_reason の 2 項目だけ（直前の最終定義の写し）', () => {
    const before = code(previous.body).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
    const after = code(latest.body).replace(`${keep}, ${keepReason}`, 'is_flagged=n.is_flagged,flag_reason=n.flag_reason');
    expect(after).toBe(before);
  });

  test('権限は service_role 専用のまま', () => {
    expect(code(sql)).toContain('REVOKE ALL ON FUNCTION public.edit_review_atomic(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;');
    expect(code(sql)).toContain('GRANT EXECUTE ON FUNCTION public.edit_review_atomic(uuid,uuid,jsonb) TO service_role;');
  });
});

test('操作 ID は一意（NULL は旧フォーム）で、型とスナップショットも知っている', () => {
  expect(code(sql)).toContain('ALTER TABLE public.facility_reviews ADD COLUMN IF NOT EXISTS client_operation_id uuid;');
  expect(code(sql)).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_facility_reviews_client_operation ON public.facility_reviews(client_operation_id) WHERE client_operation_id IS NOT NULL;');
  const snapshot = JSON.parse(readFileSync(join(ROOT, 'src/lib/schema-snapshot.json'), 'utf8'));
  expect(snapshot.facility_reviews).toContain('client_operation_id');
  const route = readFileSync(join(ROOT, 'src/app/api/review/route.ts'), 'utf8');
  expect(route).toContain("const OPERATION_INDEX = 'uq_facility_reviews_client_operation';");
});

test('実 DB での確認が CI に配線され、競合の検証もアカウント単位の重複を確かめる', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  expect(workflow).toContain('-f supabase/shadow/review-edit-account-limit-fixtures.sql');
  expect(workflow).toContain('node scripts/check-review-atomic-concurrency.mjs');
  const race = readFileSync(join(ROOT, 'scripts/check-review-atomic-concurrency.mjs'), 'utf8');
  expect(race).toContain("orderedRace('same-account-distinct-ip'");
  const fixture = readFileSync(join(ROOT, 'supabase/shadow/review-edit-account-limit-fixtures.sql'), 'utf8');
  for (const label of ['second review by the same account is rolled back', 'star-only edit keeps the approval', 'operation id maps to exactly one review']) {
    expect(fixture).toContain(label);
  }
});
