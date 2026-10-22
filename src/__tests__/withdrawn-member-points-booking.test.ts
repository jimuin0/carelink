/**
 * @jest-environment node
 *
 * 退会した会員のポイント利用予約を、店舗が受付・完了・キャンセル・会計できない（2026年10月23日）。
 *
 * 退会で bookings.user_id は ON DELETE SET NULL で NULL になり、points_used は残る。sync_booking_points は
 * 「user_id が無いのにポイントを使っている」を INSERT でも UPDATE でも POINTS_AUTH_REQUIRED にしていたので、
 * その予約の status を書き換えるたびにトランザクションごと取り消され、店舗には 500 が出続けた。
 * 20261023130000 で、作成（INSERT）のときと、持ち主の分からない台帳の行が残っているときだけ拒否する形にした。
 *
 * jest から SQL は実行できないので、実 DB での挙動（受付・完了・無断キャンセル・キャンセル・会計 2 通りが通り、
 * user_points に何も書かないこと、作成時の拒否と台帳が残る予約の拒否が変わらないこと）は
 * supabase/shadow/booking-points-withdrawn-member-fixtures.sql が CI の使い捨て PG17 で確かめる。ここでは
 *   - migration が「最新定義の写し＋意図した分岐の変更だけ」であること
 *   - 権限・属性・接続先ガード・データを書き換えないこと・適用順序の明記
 *   - fixture が CI に配線され、主張すべきことを主張していること
 * を固定する。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const MIGRATION = '20261023130000_booking_points_withdrawn_member.sql';
const SOURCE = '20261023000100_booking_visit_points_cap.sql';
const FIXTURE = 'supabase/shadow/booking-points-withdrawn-member-fixtures.sql';
const read = (name: string) => readFileSync(join(MIGRATIONS, name), 'utf8');
const sql = read(MIGRATION);

/** `FUNCTION public.sync_booking_points(` から `END $$;` まで。 */
function body(text: string): string {
  const start = text.indexOf('FUNCTION public.sync_booking_points(');
  expect(start).toBeGreaterThanOrEqual(0);
  return text.slice(start, text.indexOf('END $$;', start) + 'END $$;'.length);
}
const topLevel = (text: string) => text.replace(/\$\$[\s\S]*?\$\$/g, '$$ … $$').replace(/--[^\n]*/g, '');

const OLD_BRANCH = `  IF NEW.user_id IS NULL THEN
    IF coalesce(NEW.points_used,0)>0 THEN RAISE EXCEPTION 'POINTS_AUTH_REQUIRED'; END IF;
    RETURN NEW;
  END IF;
`;

describe('migration の形', () => {
  test('接続先ガードが最初の文', () => {
    expect(topLevel(sql).trim()).toMatch(/^DO \$guard\$ BEGIN IF to_regclass\('public\.facility_profiles'\) IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END \$guard\$;/);
  });

  test('関数の置き換えだけで、データ・トリガ・表は触らない', () => {
    const code = topLevel(sql);
    expect(code).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM|DROP|ALTER TABLE|CREATE TRIGGER|TRUNCATE)\b/i);
    expect(code.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
  });

  test('属性と権限は以前と同じ（トリガ専用・アプリのロールからは呼べない）', () => {
    expect(sql).toMatch(/FUNCTION public\.sync_booking_points\(\) RETURNS trigger\nLANGUAGE plpgsql SECURITY DEFINER SET search_path=''/);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.sync_booking_points() FROM PUBLIC,anon,authenticated,service_role;');
    expect(sql).not.toMatch(/GRANT [^;]*sync_booking_points/);
  });

  test('適用順序（デプロイの前後どちらでもよい）を明記している', () => {
    expect(sql).toContain('適用順序: アプリのデプロイの前後どちらでもよい。');
  });
});

describe('最新定義の写し＋「user_id が NULL」の分岐だけを変える', () => {
  test('このファイルより前で最後に sync_booking_points を定義しているのは 20261023000100', () => {
    const earlier = readdirSync(MIGRATIONS)
      .filter((f) => /^\d{14}_.*\.sql$/.test(f) && f < MIGRATION && read(f).includes('FUNCTION public.sync_booking_points('))
      .sort();
    expect(earlier[earlier.length - 1]).toBe(SOURCE);
    // 接頭辞の無い（最後に適用される）ファイルにも定義が無い＝巻き戻しが起きない
    expect(read('combined_phase2_to_6.sql')).not.toContain('FUNCTION public.sync_booking_points(');
  });

  test('分岐を元に戻すと 20261023000100 と一字一句同じ', () => {
    const next = body(sql);
    const branch = next.slice(next.indexOf('  IF NEW.user_id IS NULL THEN\n'), next.indexOf('  PERFORM public.lock_booking_account(NEW.user_id);'));
    expect(next.replace(branch, OLD_BRANCH)).toBe(body(read(SOURCE)));
    expect(branch).not.toBe(OLD_BRANCH);
  });

  test('作成時と、台帳の行が残っているときだけ拒否し、それ以外の UPDATE は何もせず通す', () => {
    const next = body(sql);
    expect(next).toContain(`    IF coalesce(NEW.points_used,0)>0 AND (TG_OP='INSERT'
      OR EXISTS(SELECT 1 FROM public.user_points WHERE booking_id=NEW.id))
      THEN RAISE EXCEPTION 'POINTS_AUTH_REQUIRED'; END IF;
    RETURN NEW;`);
    // 来店ポイントの上限（20261023000100）を引き継いでいる
    expect(next).toContain('earned:=public.booking_visit_points_due(NEW.user_id,NEW.facility_id,NEW.total_price,NEW.points_base_price);');
  });

  test('後の migration が sync_booking_points を定義し直すなら、この分岐を引き継ぐ', () => {
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && (f > MIGRATION || !/^\d{14}_/.test(f)))
      .filter((f) => read(f).includes('FUNCTION public.sync_booking_points('));
    for (const file of later) expect([file, body(read(file)).includes("(TG_OP='INSERT'\n      OR EXISTS(SELECT 1 FROM public.user_points WHERE booking_id=NEW.id))")]).toEqual([file, true]);
  });
});

test('実 DB での検証が CI で実行され、退会者の予約の全操作と変わらない拒否を確かめている', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  expect(workflow).toContain(`-d carelink_shadow -f ${FIXTURE}`);
  expect(workflow.indexOf('bash scripts/gen-schema-fingerprint.sh --check')).toBeLessThan(workflow.indexOf(`-f ${FIXTURE}`));
  const fixture = readFileSync(join(ROOT, FIXTURE), 'utf8');
  expect(fixture).toMatch(/^BEGIN;$/m);
  expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
  expect(fixture).toContain("DELETE FROM auth.users WHERE id = 'fe200000-0000-4000-8000-000000000002';");
  for (const label of ['受付 is saved', 'arrived -> 完了 is saved', '完了 is saved', 'completion corrected to 無断キャンセル',
    '無断キャンセル is saved', 'キャンセル is saved', 'checkout without completion is saved', 'checkout that completes is saved',
    'no user_points rows are written for the withdrawn bookings', 'the refused guest booking is not stored',
    'a booking whose ledger rows remain without an owner is still refused', 'the member gets the points back']) {
    expect(fixture).toContain(label);
  }
});
