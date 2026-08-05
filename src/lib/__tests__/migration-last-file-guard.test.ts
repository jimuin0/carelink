/**
 * 「最後に適用される migration が、後続の改良を巻き戻さない」ことを機械で強制する。
 *
 * 🔴 why(2026年8月5日 実測): `combined_phase2_to_6.sql` は後続 migration が作る
 *   facility_reviews 等に依存するため【最後に適用する必要がある】ファイルなのに、
 *   handle_new_user / get_available_slots を **古い定義で CREATE OR REPLACE** していた。
 *   その結果 fresh-apply のたびに次の改良が全部巻き戻っていた:
 *     get_available_slots … booking_buffer / exclude_cancel_fee_paid /
 *       availability_security_definer / staff_facility_guard_and_symmetric_buffer /
 *       business_hours_slot_gate（5 本ぶん）
 *     handle_new_user … oauth_displayname / signup_phone_prefecture_capture
 *
 *   実害は「新環境が古くなる」だけではない。CI は `supabase start` で fresh-apply した
 *   DB に対して E2E を回すため、**営業時間ガードもバッファも無い get_available_slots と、
 *   ON CONFLICT も EXCEPTION ハンドラも無い handle_new_user を検証し続けていた**。
 *   fresh-apply の乖離を捕まえるためのゲートが、本番と別物を検証していた。
 *
 * 真の予防: ファイル名を時系列に直す案は不可（依存関係から最後に走る必要がある）。
 *   代わりに **最後に走るファイルへ関数定義を置けない** ようにする。
 *   1 本ずつ気づいて消す運用は「発火源の列挙」で、次に足される定義を守らない。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');

/** シェルの glob / supabase CLI と同じ辞書順で並べる。 */
function applyOrder(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
}

describe('最後に適用される migration が後続を巻き戻さないこと', () => {
  it('走査が空振りしていない（migration が十分な数ある）', () => {
    expect(applyOrder().length).toBeGreaterThanOrEqual(100);
  });

  it('🔴 タイムスタンプ接頭辞を持たない migration は関数を定義してはいけない', () => {
    // 接頭辞が無いファイルは辞書順で 2026* より後に来る＝必ず最後に走る。
    // そこに CREATE FUNCTION があると、後続 migration の改良を無条件で上書きする。
    const offenders: string[] = [];
    for (const f of applyOrder()) {
      if (/^\d{14}_/.test(f)) continue;              // 時系列ファイルは対象外
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
      const m = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi);
      if (m) offenders.push(`${f}: ${m.join(', ')}`);
    }
    if (offenders.length > 0) {
      throw new Error(
        'タイムスタンプ接頭辞の無い migration が関数を定義しています。'
        + 'このファイルは辞書順で必ず最後に走るため、後続 migration の改良を無条件で'
        + '巻き戻します（実際に get_available_slots が 5 本ぶん、handle_new_user が'
        + ' 2 本ぶん巻き戻っていました）。定義は時系列の migration へ移してください:\n  '
        + offenders.join('\n  '));
    }
    expect(offenders).toEqual([]);
  });

  it('🔴 負の対照: 検出ロジックが CREATE FUNCTION を実際に見つけられる', () => {
    // 「常に緑」でないことを実証する。正規表現が壊れれば永久に通ってしまう。
    const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi;
    expect('CREATE OR REPLACE FUNCTION handle_new_user()'.match(re)).not.toBeNull();
    expect('CREATE FUNCTION public.foo()'.match(re)).not.toBeNull();
    expect('SELECT 1;'.match(re)).toBeNull();
  });

  it('タイムスタンプ無しのファイルが実在する（この検査が空振りでない）', () => {
    // combined_phase2_to_6.sql のような依存の都合で最後に走るファイル。
    // 将来ゼロになったらこの検査は不要になるが、黙って無意味化させない。
    const untimestamped = applyOrder().filter((f) => !/^\d{14}_/.test(f));
    expect(untimestamped.length).toBeGreaterThanOrEqual(1);
    expect(untimestamped[untimestamped.length - 1]).toBe(applyOrder()[applyOrder().length - 1]);
  });
});
