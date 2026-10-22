/**
 * @jest-environment node
 *
 * 無料掲載の公開に曜日別の営業時間を必須にする migration（20261023170000・2026年10月23日 神原さん決定）を固定する。
 *
 * jest から SQL は実行できないため、実 DB での挙動は supabase/shadow/publish-hours-fixtures.sql が
 * CI の使い捨て PG17 で確かめる。ここでは
 *   - 公開 RPC 2 本が「最新定義の写し＋営業時間の判定だけ」であること（写し間違いで他の挙動を壊さない）
 *   - 判定がネット予約と同じ public.confirmed_booking_hours を使い、公開済みの行を無関係な保存で再検査しないこと
 *   - 接続先ガード・権限・データを書き換えないこと
 *   - アプリ側の衝突判定（isPublishedHoursConflict）と同じ名前を投げること
 *   - shadow fixture が CI に配線されていること
 * を固定する。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPublishedHoursConflict } from '@/lib/facility-publish-gate';

const ROOT = process.cwd();
const read = (name: string) => readFileSync(join(ROOT, 'supabase/migrations', name), 'utf8');
const MIGRATION = read('20261023170000_publish_requires_confirmed_hours.sql');
const SETTINGS_SOURCE = read('20261008080211_atomic_moderation_and_photos.sql');
const PUBLICATION_SOURCE = read('20261002012217_booking_transition_outbox_and_publish_authorization.sql');

/** `CREATE [OR REPLACE] FUNCTION public.<name>(` から本文の終わり（`$$;`）まで。 */
function definition(text: string, name: string): string {
  const match = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`).exec(text);
  expect(match).not.toBeNull();
  const start = match!.index;
  const end = text.indexOf('\n$$;', start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end + 4).replace(/^CREATE (OR REPLACE )?FUNCTION/, 'CREATE OR REPLACE FUNCTION');
}
/** $$ … $$ の中（関数本文）とコメントを除いた SQL。トップレベルの文だけを見るため。 */
const topLevel = (text: string) => text.replace(/\$([a-z]*)\$[\s\S]*?\$\1\$/g, () => '<body>').replace(/--[^\n]*/g, '');

const SETTINGS_CHECK = `  -- published_facility_hours_confirmed: a publish, or a change of a published row's hours, needs confirmed hours.
  IF n.status='published'
    AND (f.status IS DISTINCT FROM 'published' OR n.business_hours IS DISTINCT FROM f.business_hours)
    AND NOT public.confirmed_booking_hours(n.business_hours)
    THEN RAISE check_violation USING MESSAGE='"published_facility_hours_confirmed"'; END IF;
`;
const PUBLICATION_CHECK = `    -- published_facility_hours_confirmed: only a publish is checked; an already published row is left as is.
    IF p_is_published AND f.status IS DISTINCT FROM 'published'
      AND NOT public.confirmed_booking_hours(f.business_hours)
    THEN RAISE check_violation USING MESSAGE = '"published_facility_hours_confirmed"'; END IF;
`;

describe('20261023170000: 無料掲載の公開に営業時間を必須にする', () => {
  test('接続先ガードが最初の文', () => {
    expect(topLevel(MIGRATION).trim()).toMatch(/^DO <body>;/);
    expect(MIGRATION).toMatch(/^DO \$guard\$\nBEGIN\n {2}IF to_regclass\('public\.facility_profiles'\) IS NULL THEN\n {4}RAISE EXCEPTION 'not the CareLink database';/m);
    expect(MIGRATION.indexOf('DO $guard$')).toBeLessThan(MIGRATION.indexOf('CREATE OR REPLACE FUNCTION'));
  });

  test('データを書き換えない・制約を足さない（既存の公開行を非公開にしない・再検証しない）', () => {
    expect(topLevel(MIGRATION)).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM|DROP|ALTER TABLE|CONSTRAINT|CREATE TRIGGER)\b/i);
  });

  test('update_facility_settings_atomic は最新定義（20261008080211）に判定を足しただけ', () => {
    const next = definition(MIGRATION, 'update_facility_settings_atomic');
    expect(next).toContain(SETTINGS_CHECK);
    expect(next.replace(SETTINGS_CHECK, '')).toBe(definition(SETTINGS_SOURCE, 'update_facility_settings_atomic'));
    // 所有者・所在地の検査より後（エラーの種類が変わらない）。
    expect(next.indexOf('FACILITY_OWNER_REQUIRED')).toBeLessThan(next.indexOf('published_facility_hours_confirmed'));
    expect(next.indexOf('published_facility_location_present')).toBeLessThan(next.indexOf('published_facility_hours_confirmed'));
  });

  test('set_facilities_publication_atomic は最新定義（20261002012217）に判定を足しただけ', () => {
    const next = definition(MIGRATION, 'set_facilities_publication_atomic');
    expect(next).toContain(PUBLICATION_CHECK);
    expect(next.replace(PUBLICATION_CHECK, '')).toBe(definition(PUBLICATION_SOURCE, 'set_facilities_publication_atomic'));
    expect(next.indexOf('published_facility_location_present')).toBeLessThan(next.indexOf('published_facility_hours_confirmed'));
  });

  test('写し元より後に公開 RPC を定義し直す migration が無い（写し元が本当に最新）', () => {
    const later = readdirSync(join(ROOT, 'supabase/migrations'))
      .filter(name => name.endsWith('.sql'))
      .filter(name => /CREATE (OR REPLACE )?FUNCTION public\.(update_facility_settings_atomic|set_facilities_publication_atomic)\(/.test(read(name)))
      .sort();
    expect(later).toEqual([
      '20261002012217_booking_transition_outbox_and_publish_authorization.sql',
      '20261008080211_atomic_moderation_and_photos.sql',
      '20261023170000_publish_requires_confirmed_hours.sql',
    ]);
  });

  test('権限は従来どおり service_role だけ（REVOKE / GRANT を言い直す）', () => {
    for (const signature of ['update_facility_settings_atomic(uuid,uuid,jsonb)', 'set_facilities_publication_atomic(uuid,uuid[],boolean)']) {
      expect(MIGRATION).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC,anon,authenticated;`);
      expect(MIGRATION).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
    }
    expect(MIGRATION).not.toMatch(/GRANT [^;]*TO [^;]*(anon|authenticated|PUBLIC)/);
  });

  test('アプリの衝突判定と同じ名前・同じ SQLSTATE を投げる', () => {
    expect(MIGRATION.match(/RAISE check_violation USING MESSAGE ?= ?'"published_facility_hours_confirmed"'/g)).toHaveLength(2);
    expect(isPublishedHoursConflict({ code: '23514', message: '"published_facility_hours_confirmed"' })).toBe(true);
  });

  test('ヘッダーに適用順を書いてある', () => {
    expect(MIGRATION).toMatch(/Apply order: after 20261002012045/);
    expect(MIGRATION).toContain('20261023164100');
  });

  test('shadow fixture が CI に配線され、公開拒否・既存公開行の非再検査・一括公開を確かめる', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
    expect(workflow).toContain('psql -X -v ON_ERROR_STOP=1 -d carelink_shadow -f supabase/shadow/publish-hours-fixtures.sql');
    const fixture = readFileSync(join(ROOT, 'supabase/shadow/publish-hours-fixtures.sql'), 'utf8');
    expect(fixture).toContain("'publish without hours refused: '");
    expect(fixture).toContain("'legacy published row is not re-validated by unrelated writes'");
    expect(fixture).toContain("'bulk publish without hours refused: '");
    expect(fixture).toContain("'published row cannot drop its hours: '");
    expect(fixture.trimEnd().endsWith('ROLLBACK;')).toBe(true);
  });
});
