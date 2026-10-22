/**
 * @jest-environment node
 *
 * 来店ポイントの上限＝予約時の金額（2026年10月23日・神原さん決定 2026年10月22日「予約時の金額を上限にする」）。
 *
 * 以前は完了時の total_price の 1% を上限なしで付与していたため、退店レジ会計で打ち間違えた（または
 * 意図的に高くした）金額が、全店で使える共通ポイントとして何倍にも発行された。店舗の owner / admin が
 * 自店を予約して完了させても付与されていた。migration 20261023000100 で:
 *   - 予約 RPC が bookings.points_base_price（ポイント利用前の予約金額）を保存し、
 *   - 来店ポイント＝floor(least(完了時の total_price, points_base_price) / 100)（NULL の既存予約は従来どおり）、
 *   - 予約者がその店舗の owner / admin なら 0、
 * とした。式は booking_visit_points_due() の 1 か所にあり、トリガ・完了 RPC の再実行チェック・台帳監査が使う。
 *
 * 価格の無いメニュー（要相談など）は予約時の金額が 0 円になるので来店ポイントは付かない（上限を外すと元の穴に
 * 戻るため、意図してそうしている）。migration の冒頭・fixture・/admin/manual に明記する。
 *
 * jest から SQL は実行できないため、実 DB での挙動（上限・既存予約・本人予約・価格の無いメニュー・取消・監査・
 * 権限）は supabase/shadow/booking-points-cap-fixtures.sql が CI の使い捨て PG17 で確かめる。ここでは
 *   - migration が「最新定義の写し＋意図した変更だけ」であること（コピーの取りこぼしで他の挙動を壊さない）
 *   - 権限・接続先ガード・データを書き換えないこと
 *   - shadow fixture が CI に配線されていること
 *   - 期待フィンガープリントが migration に追従していること（追従していないと CI の
 *     schema-fingerprint job が --check で落ち、以降の fixture が 1 本も走らない）
 * を固定する。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const MIGRATION = '20261023000100_booking_visit_points_cap.sql';
const POINTS_SOURCE = '20261008080209_atomic_booking_points.sql';
const CREATE_SOURCE = '20261022160000_coupon_target_eligibility.sql';
const read = (name: string) => readFileSync(join(MIGRATIONS, name), 'utf8');
const sql = read(MIGRATION);
const HELPER_CALL_NEW = 'public.booking_visit_points_due(NEW.user_id,NEW.facility_id,NEW.total_price,NEW.points_base_price)';
const HELPER_CALL_B = 'public.booking_visit_points_due(b.user_id,b.facility_id,b.total_price,b.points_base_price)';

/** `FUNCTION public.<name>(` から本文の終わり（plpgsql は `END $$;`、sql は行頭の `$$;`）まで。 */
function functionBody(text: string, name: string): string {
  const start = text.indexOf(`FUNCTION public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const ends = [text.indexOf('END $$;', start), text.indexOf('\n$$;', start)].filter((i) => i > 0);
  return text.slice(start, Math.min(...ends));
}

/** $$ … $$ の中（関数本文）を除いた SQL。トップレベルの文だけを見るため。 */
const topLevel = (text: string) => text.replace(/\$\$[\s\S]*?\$\$/g, '$$ … $$').replace(/--[^\n]*/g, '');

describe('migration の形', () => {
  test('接続先ガードが最初の文', () => {
    expect(topLevel(sql).trim()).toMatch(/^DO \$guard\$ BEGIN IF to_regclass\('public\.facility_profiles'\) IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END \$guard\$;/);
  });

  test('列は NULL 可の追加だけ（既定値なし＝既存の予約は NULL のまま従来の計算）', () => {
    expect(sql).toContain('ALTER TABLE public.bookings ADD COLUMN points_base_price integer\n  CONSTRAINT bookings_points_base_price_check CHECK (points_base_price >= 0);');
    expect(sql).not.toMatch(/points_base_price integer[^;]*(NOT NULL|DEFAULT)/);
  });

  test('データを書き換えない（トップレベルに UPDATE / INSERT / DELETE が無い）', () => {
    expect(topLevel(sql)).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM)\b/i);
  });

  test('式は booking_visit_points_due の 1 か所: 本人予約は 0・LEAST で上限・service_role 専用', () => {
    const helper = functionBody(sql, 'booking_visit_points_due');
    expect(helper).toMatch(/RETURNS int LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''/);
    expect(helper).toContain('WHEN p_user_id IS NULL THEN 0');
    expect(helper).toContain("m.facility_id = p_facility_id AND m.user_id = p_user_id AND m.role IN ('owner', 'admin')) THEN 0");
    expect(helper).toContain('ELSE floor(GREATEST(LEAST(COALESCE(p_total_price, 0), p_points_base_price), 0) / 100.0)::int');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.booking_visit_points_due(uuid,uuid,int,int) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.booking_visit_points_due(uuid,uuid,int,int) TO service_role;');
    expect(sql).not.toMatch(/GRANT [^;]*booking_visit_points_due[^;]*TO [^;]*(anon|authenticated|PUBLIC)/);
  });

  test('トリガ・完了 RPC の再実行チェック・台帳監査が同じ式を使い、旧い式を残さない', () => {
    expect(functionBody(sql, 'sync_booking_points')).toContain(`earned:=${HELPER_CALL_NEW};`);
    expect(functionBody(sql, 'complete_booking_with_points_atomic')).toContain(`IS DISTINCT FROM ${HELPER_CALL_B}`);
    expect(functionBody(sql, 'booking_point_legacy_issues').split(HELPER_CALL_B)).toHaveLength(3);
    for (const name of ['sync_booking_points', 'complete_booking_with_points_atomic', 'booking_point_legacy_issues']) {
      expect([name, /floor\([^)]*total_price/.test(functionBody(sql, name))]).toEqual([name, false]);
    }
  });

  test('置き換えた関数の権限を再記述している（旧定義と同じ）', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.sync_booking_points() FROM PUBLIC,anon,authenticated,service_role;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.complete_booking_with_points_atomic(uuid,uuid,text) FROM PUBLIC,anon,authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.complete_booking_with_points_atomic(uuid,uuid,text) TO service_role;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.booking_point_legacy_issues() FROM PUBLIC,anon,authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.booking_point_legacy_issues() TO service_role;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])\n  FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])\n  TO service_role;');
    expect(sql).toMatch(/FUNCTION public\.sync_booking_points\(\) RETURNS trigger\nLANGUAGE plpgsql SECURITY DEFINER SET search_path=''/);
  });
});

describe('最新定義の写し＋意図した変更だけ', () => {
  test.each([
    ['sync_booking_points', (t: string) => t
      .replace("    -- Capped at the booking-time amount; nothing for the shop's own owner / admin (20261023000100).\n", '')
      .replace(`earned:=${HELPER_CALL_NEW};`, 'earned:=floor(greatest(coalesce(NEW.total_price,0),0)/100.0)::int;')],
    ['complete_booking_with_points_atomic', (t: string) => t
      .replace(`IS DISTINCT FROM ${HELPER_CALL_B}`, 'IS DISTINCT FROM (CASE WHEN b.user_id IS NULL THEN 0 ELSE floor(greatest(coalesce(b.total_price,0),0)/100.0)::int END)')],
    ['booking_point_legacy_issues', (t: string) => t
      .replace(`    WHERE b.user_id IS NOT NULL AND b.status='completed'
      AND ${HELPER_CALL_B}>0
      AND NOT EXISTS(SELECT 1 FROM public.user_points p WHERE p.booking_id=b.id AND p.user_id=b.user_id
        AND p.booking_operation='award'
        AND p.points=${HELPER_CALL_B})`,
      `    WHERE b.user_id IS NOT NULL AND b.status='completed' AND coalesce(b.total_price,0)>=100
      AND NOT EXISTS(SELECT 1 FROM public.user_points p WHERE p.booking_id=b.id AND p.user_id=b.user_id
        AND p.booking_operation='award' AND p.points=floor(b.total_price/100.0)::int)`)],
  ])('%s は 20261008080209 の写し', (name, undo) => {
    const next = functionBody(sql, name);
    expect(undo(next)).toBe(functionBody(read(POINTS_SOURCE), name));
    expect(next).not.toBe(functionBody(read(POINTS_SOURCE), name));
  });

  test('create_booking_for_menus_atomic は 20261022160000 の写しで、INSERT に points_base_price を足しただけ', () => {
    const HEAD = 'CREATE OR REPLACE FUNCTION public.create_booking_for_menus_atomic(';
    const TAIL = 'GRANT EXECUTE ON FUNCTION public.create_booking_for_menus_atomic(uuid,uuid,uuid,uuid,uuid,date,time,time,text,text,text,text,int,int,text,boolean,uuid[])\n  TO service_role;';
    const block = (text: string) => text.slice(text.indexOf(HEAD), text.indexOf(TAIL, text.indexOf(HEAD)) + TAIL.length);
    const next = block(sql);
    const undo = next
      .replace('    total_price, points_used, status, points_base_price\n', '    total_price, points_used, status\n')
      .replace(/    p_total_price, p_points_used, p_status,\n[\s\S]*?\n  \)\n  RETURNING id INTO v_booking_id;/,
        '    p_total_price, p_points_used, p_status\n  )\n  RETURNING id INTO v_booking_id;');
    expect(undo).toBe(block(read(CREATE_SOURCE)));
    expect(next).not.toBe(undo);
    // ログインした予約だけ。p_total_price はポイント利用後なので、利用ポイントを足し戻して利用前の金額にする。
    expect(next).toContain('CASE WHEN p_user_id IS NULL THEN NULL\n      ELSE LEAST(GREATEST(COALESCE(p_total_price, 0), 0)::BIGINT + GREATEST(COALESCE(p_points_used, 0), 0), 2147483647)::INT END');
  });

  test('後の migration がこれらの関数を定義し直すなら、同じ式（booking_visit_points_due）を使い続ける', () => {
    const names = ['sync_booking_points', 'complete_booking_with_points_atomic', 'booking_point_legacy_issues', 'create_booking_for_menus_atomic'];
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && (f > MIGRATION || !/^\d{14}_/.test(f)))
      .filter((f) => names.some((n) => read(f).includes(`FUNCTION public.${n}(`)));
    for (const file of later) {
      const text = read(file);
      for (const name of names.slice(0, 3)) {
        if (text.includes(`FUNCTION public.${name}(`)) expect([file, name, functionBody(text, name).includes('booking_visit_points_due')]).toEqual([file, name, true]);
      }
      if (text.includes('FUNCTION public.create_booking_for_menus_atomic(')) expect([file, text.includes('points_base_price')]).toEqual([file, true]);
    }
  });
});

test('実 DB での検証（上限・既存予約・本人予約・取消・監査・台帳の閲覧）が CI で実行される', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  expect(workflow).toContain('-d carelink_shadow -f supabase/shadow/booking-points-cap-fixtures.sql');
  expect(workflow.indexOf('bash scripts/gen-schema-fingerprint.sh --check'))
    .toBeLessThan(workflow.indexOf('-f supabase/shadow/booking-points-cap-fixtures.sql'));
  const fixture = readFileSync(join(ROOT, 'supabase/shadow/booking-points-cap-fixtures.sql'), 'utf8');
  expect(fixture).toMatch(/^BEGIN;$/m);
  expect(fixture.trim().endsWith('ROLLBACK;')).toBe(true);
  for (const label of ['booking stores the amount before points', 'inflated checkout earns at most 1% of the booking amount',
    'capped checkout replays without a reconciliation error', 'legacy row earns on the completed total, never above it',
    'owner self-booking earns nothing', 'admin self-booking earns nothing', 'reversal returns the capped award',
    'audit reports nothing for the new rule', "the shop owner cannot read the customer''s ledger",
    'user_points keeps only the own-read policy', 'unpriced menu stores a zero booking amount',
    'unpriced menu earns no visit points whatever the checkout total']) {
    expect(fixture).toContain(label);
  }
});

test('価格の無いメニューに来店ポイントが付かないことを、migration と /admin/manual に明記している', () => {
  expect(sql).toContain('価格の無いメニューには来店ポイントが付かない（意図した結果）');
  const manual = readFileSync(join(ROOT, 'src/app/admin/manual/page.tsx'), 'utf8');
  expect(manual).toContain('価格を設定していないメニュー（要相談など）の予約と、施設のオーナー・管理者ご本人の予約には来店ポイントは付きません');
  expect(manual).toContain('予約時の金額（メニュー料金＋指名料−クーポン、ポイント利用前）が上限');
  // お客様のポイントは本人しか読めない（20261023000000）。店舗が残高を見られるとは書かない。
  expect(manual).not.toContain('ポイント残高も確認できます');
});

test('期待フィンガープリントが 2 本の migration に追従している', () => {
  const expected: string[] = JSON.parse(readFileSync(join(ROOT, 'src/lib/schema-fingerprint.expected.json'), 'utf8'));
  expect(expected).toContain('column|bookings.points_base_price|integer|notnull=f|default=|generated=');
  expect(expected).toContain('constraint|bookings|c|bookings_points_base_price_check|CHECK ((points_base_price >= 0))');
  expect(expected).toContain('functiongrant|public.booking_visit_points_due(uuid,uuid,integer,integer)|service_role|EXECUTE');
  expect(expected.filter((l) => l.startsWith('functiongrant|public.booking_visit_points_due('))).toHaveLength(1);
  expect(expected.some((l) => l.startsWith('function|booking_visit_points_due(p_user_id uuid, p_facility_id uuid, p_total_price integer, p_points_base_price integer)|returns=integer|volatile=s|secdef=f|'))).toBe(true);
  expect(expected.filter((l) => l.startsWith('policy|user_points|')).map((l) => l.split('|')[2])).toEqual(['user_points_own_read']);
});
