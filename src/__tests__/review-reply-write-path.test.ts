/**
 * @jest-environment node
 *
 * 口コミへの店舗返信の書き込み経路を固定する（2026年10月22日 新設）。
 *
 * 【神原さん決定】SALON BOARD と同じく、店舗の owner / admin は投稿した返信を後から編集・削除できる。
 * 書き込み（公開・編集・削除）は /api/admin/review-replies → service_role 専用の RPC だけで行い、
 * RPC の中で「今もその店舗の owner / admin か」を行ロックつきで確かめる。ブラウザから
 * review_replies へ直接書く権限は無い（supabase/migrations/20261022140000_review_reply_edit_delete.sql）。
 *
 * 守るもの:
 *   1. migration が接続先ガードを最初に持ち、RPC を service_role 専用にし、ブラウザの書き込み権と
 *      INSERT ポリシーを外している（後の migration が書き込み権を戻していない）
 *   2. 文字数の上限が画面・API・DB で同じ値
 *   3. アプリのコードが review_replies へ直接書いていない（読み取りは可）
 *   4. 実 DB での検証（shadow fixture）が CI に配線されている
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { REVIEW_REPLY_MAX_LENGTH } from '@/lib/review-reply-limits';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const MIGRATION = '20261022140000_review_reply_edit_delete.sql';
const sql = readFileSync(join(MIGRATIONS, MIGRATION), 'utf8');
/** コメントを除いた SQL（説明文の中の語に反応しない）。 */
const code = (text: string) => text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
const body = code(sql);
const RPCS = [
  'create_review_reply_atomic(uuid, uuid, uuid, text)',
  'update_review_reply_atomic(uuid, uuid, uuid, text)',
  'delete_review_reply_atomic(uuid, uuid, uuid)',
];

describe('migration', () => {
  test('接続先ガードが最初の文', () => {
    expect(body.trim()).toMatch(/^DO \$guard\$ BEGIN IF to_regclass\('public\.facility_profiles'\) IS NULL THEN RAISE EXCEPTION/);
  });

  test.each(RPCS)('%s は SECURITY INVOKER・search_path 固定・service_role 専用', (signature) => {
    const name = signature.slice(0, signature.indexOf('('));
    expect(body).toMatch(new RegExp(`CREATE FUNCTION public\\.${name}\\([^)]*\\) RETURNS TABLE\\([^)]*\\) LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''`));
    expect(body).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`);
    expect(body).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
    expect(body).not.toMatch(new RegExp(`GRANT [^;]*ON FUNCTION public\\.${name}[^;]*TO [^;]*(anon|authenticated|PUBLIC)`));
  });

  test('どの RPC も、その店舗の owner / admin であることを確かめてから書く', () => {
    const checks = body.match(/m\.role IN \('owner', 'admin'\) FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REPLY_FORBIDDEN' USING ERRCODE = '42501'/g);
    expect(checks).toHaveLength(3);
  });

  test('ブラウザの書き込み権と INSERT ポリシーを外し、新しい書き込みポリシーを作らない', () => {
    expect(body).toContain('REVOKE INSERT, UPDATE, DELETE ON public.review_replies FROM anon, authenticated;');
    expect(body).toContain('DROP POLICY IF EXISTS review_replies_facility_member_insert ON public.review_replies;');
    expect(body).not.toMatch(/CREATE POLICY [^;]*review_replies/i);
    expect(body).not.toMatch(/GRANT [^;]*ON (TABLE )?public\.review_replies/i);
  });

  test('後の migration が review_replies への書き込み権・書き込みポリシーを戻していない', () => {
    const later = readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f > MIGRATION);
    for (const file of later) {
      const text = code(readFileSync(join(MIGRATIONS, file), 'utf8'));
      expect([file, /GRANT [^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*ON (TABLE )?(public\.)?review_replies[^;]*TO [^;]*(anon|authenticated|PUBLIC)/i.test(text)])
        .toEqual([file, false]);
      expect([file, /CREATE POLICY [^;]*ON (public\.)?review_replies [^;]*FOR (INSERT|UPDATE|DELETE|ALL)/i.test(text)])
        .toEqual([file, false]);
    }
  });
});

describe('文字数の上限は画面・API・DB で同じ', () => {
  test('RPC の上限が REVIEW_REPLY_MAX_LENGTH と一致し、空白だけも弾く', () => {
    const limits = [...body.matchAll(/char_length\(p_content\) > (\d+)/g)].map((m) => Number(m[1]));
    expect(limits).toEqual([REVIEW_REPLY_MAX_LENGTH, REVIEW_REPLY_MAX_LENGTH]);
    expect(body.match(/btrim\(p_content\) = ''/g)).toHaveLength(2);
  });

  test('管理画面の入力欄は同じ定数を maxLength に使い、書き込みは API を通す', () => {
    const page = readFileSync(join(ROOT, 'src/app/admin/reviews/page.tsx'), 'utf8');
    expect(page.match(/maxLength=\{REVIEW_REPLY_MAX_LENGTH\}/g)).toHaveLength(2);
    expect(page).not.toMatch(/maxLength=\{\d+\}/);
    expect(page).toContain('/api/admin/review-replies');
  });
});

describe('アプリのコードは review_replies へ直接書かない', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : walk(full);
      return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }
  const sources = walk(join(ROOT, 'src'));
  const statements = sources.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(/\.from\(\s*['"]review_replies['"]\s*\)[^;]*/g)]
      .map((m) => ({ file: relative(ROOT, file), statement: m[0] }));
  });

  test('空振りしていない（読み取りは管理画面と店舗ページの 2 箇所にある）', () => {
    expect(sources.length).toBeGreaterThan(500);
    expect(statements.map((s) => s.file).sort()).toEqual([
      'src/app/admin/reviews/page.tsx',
      'src/components/facility/ReviewList.tsx',
    ]);
  });

  test('どれも読み取りだけ（insert / update / upsert / delete を呼ばない）', () => {
    const writes = statements.filter((s) => /\.(insert|update|upsert|delete)\s*\(/.test(s.statement));
    expect(writes).toEqual([]);
  });

  test('検出が働いている（負の対照）', () => {
    const sample = "supabase.from('review_replies').insert({ review_id, content })";
    const found = [...sample.matchAll(/\.from\(\s*['"]review_replies['"]\s*\)[^;]*/g)].map((m) => m[0]);
    expect(found.filter((s) => /\.(insert|update|upsert|delete)\s*\(/.test(s))).toHaveLength(1);
  });
});

test('実 DB での検証（非メンバーは書けず、メンバーは書ける）が CI で実行される', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  expect(workflow).toContain('-d carelink_shadow -f supabase/shadow/review-reply-fixtures.sql');
  const fixture = readFileSync(join(ROOT, 'supabase/shadow/review-reply-fixtures.sql'), 'utf8');
  expect(fixture).toMatch(/^BEGIN;$/m);
  expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
  for (const label of ['non-member edit accepted', 'non-member delete accepted', 'owner publishes', 'admin edit at the limit',
    'owner delete returns the removed text', 'direct UPDATE accepted', 'direct DELETE accepted', 'revoked admin edit accepted']) {
    expect(fixture).toContain(label);
  }
});
