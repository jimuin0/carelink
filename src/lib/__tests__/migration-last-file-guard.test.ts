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

/**
 * 「最後に適用される非タイムスタンプ migration が、タイムスタンプ付き migration 群の
 * DROP POLICY を巻き戻さない」ことを機械で強制する（CREATE POLICY 版・2026年8月9日）。
 *
 * 🔴 why: #568 (fb571b3) は combined_phase2_to_6.sql の CREATE POLICY 3本を手で見つけて
 *   個別に除去したが、上の CREATE FUNCTION 検査と違い、CREATE POLICY には**まだ機械の
 *   再発防止が無い**。「タイムスタンプ付き migration が定義してはいけない」と同じ単純な
 *   全面禁止にはできない — CREATE POLICY は combined に **23本** あり、そのほとんどは
 *   一度も DROP されていない正規のポリシー、一部（customer_visits の2本）は「TS が DROP
 *   した後 owner/admin 版で再 CREATE 済み」で combined 側は常にスキップされる死にコード
 *   （巻き戻しではない）。全面禁止ではなく、**TS migration 群を適用順にたたみ込んだ
 *   最終状態**を計算し、「TS が最終的に『不在』にしたポリシーを非TSが復活させる」形
 *   （= #568 の bookings 型）だけを offense とする必要がある。
 *
 * 不変条件:
 *   (policyname, table) ごとに、タイムスタンプ付き migration（`^\d{14}_` で始まるファイル）
 *   を適用順（辞書順）にたたみ込み、最後に見た操作が DROP なら『不在』、CREATE なら
 *   『存在』と判定する。タイムスタンプ無し migration（combined 等）の CREATE POLICY は、
 *   その (policyname, table) の TS 最終状態が『不在』であれば offense（＝ TS の DROP を
 *   巻き戻す）。『存在』または TS が一度も触れていない場合は offense ではない
 *   （前者は死にコードとしてのスキップ、後者は combined が唯一の定義元である正規ケース）。
 *
 * ⚠️ スコープの限界（自己申告）: 一部の migration は
 *   `EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, tbl)` のように
 *   pg_policies を動的走査して名前不問で DROP する（例:
 *   20260604000001 / 20260604000003 / 20260809000001）。これは静的にポリシー名を
 *   解決できないため、このガードのたたみ込みには含めていない。現状はこの3ファイルが
 *   対象とするテーブル（facility_inquiries / intake_form_responses / booking_waitlist /
 *   referral_uses / ab_test_events）が combined の23本と1件も重複しないことを実測済み
 *   （重複すれば見逃しになり得るため、将来重複が増えたら別途対応が必要）。
 */
describe('最後に適用される migration が DROP POLICY を巻き戻さないこと', () => {
  type PolicyEvent = { kind: 'CREATE' | 'DROP'; table: string; name: string };

  /** 行頭（trim後）が `--` の行だけを空行に落とす。文中コメントは対象外＝最低限の除外。 */
  function stripLineComments(sql: string): string {
    return sql
      .split('\n')
      .map((line) => (line.trim().startsWith('--') ? '' : line))
      .join('\n');
  }

  // DROP POLICY [IF EXISTS] "name" ON table  /  CREATE POLICY "name" ON table
  // ポリシー名は本リポジトリ内で常に二重引用符付きリテラル（実測: 非コメント行に
  // 引用符無し・%I 動的展開以外の形は存在しない）。%I 動的展開は意図的に非対象（上記の
  // スコープの限界を参照）。
  const POLICY_EVENT_RE =
    /\bDROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+([a-zA-Z_][a-zA-Z0-9_.]*)|\bCREATE\s+POLICY\s+"([^"]+)"\s+ON\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gis;

  /** ファイル内での出現順（＝実行順）で DROP/CREATE イベントを抽出する。 */
  function extractPolicyEvents(sql: string): PolicyEvent[] {
    const cleaned = stripLineComments(sql);
    const events: PolicyEvent[] = [];
    for (const m of cleaned.matchAll(POLICY_EVENT_RE)) {
      if (m[1] !== undefined) {
        events.push({ kind: 'DROP', table: m[2], name: m[1] });
      } else {
        events.push({ kind: 'CREATE', table: m[4], name: m[3] });
      }
    }
    return events;
  }

  const isTimestamped = (f: string) => /^\d{14}_/.test(f);

  /** TS migration 群を適用順にたたみ込み、(table, name) ごとの最終状態を返す。 */
  function foldTsFinalState(files: string[], readFile: (f: string) => string) {
    const state = new Map<string, 'exists' | 'absent'>();
    for (const f of files.filter(isTimestamped)) {
      for (const ev of extractPolicyEvents(readFile(f))) {
        const key = `${ev.table}::${ev.name}`;
        state.set(key, ev.kind === 'CREATE' ? 'exists' : 'absent');
      }
    }
    return state;
  }

  /**
   * 非TS migration の CREATE POLICY が、TS 最終状態『不在』のポリシーを復活させていないか。
   * offenders を `table::name -> 巻き戻す理由` の Map で返す（空なら健全）。
   */
  function findRollbackOffenses(
    files: string[],
    readFile: (f: string) => string
  ): Map<string, string> {
    const tsFinal = foldTsFinalState(files, readFile);
    const offenders = new Map<string, string>();
    for (const f of files.filter((x) => !isTimestamped(x))) {
      for (const ev of extractPolicyEvents(readFile(f))) {
        if (ev.kind !== 'CREATE') continue;
        const key = `${ev.table}::${ev.name}`;
        if (tsFinal.get(key) === 'absent') {
          offenders.set(
            key,
            `${f} が CREATE POLICY "${ev.name}" ON ${ev.table} を持つが、タイムスタンプ付き ` +
              'migration 群の最終状態はこのポリシーを DROP 済み（再 CREATE 無し）。' +
              'このファイルは辞書順で最後に適用されるため、CREATE すると TS 側の DROP を' +
              '無条件に巻き戻す。'
          );
        }
      }
    }
    return offenders;
  }

  function readRepoMigration(f: string): string {
    return readFileSync(join(MIGRATIONS, f), 'utf8');
  }

  it('空振り下限（TS migration が十分な数あり、非TSファイルが1本以上ある）', () => {
    const files = applyOrder();
    const tsCount = files.filter(isTimestamped).length;
    const nonTsCount = files.filter((f) => !isTimestamped(f)).length;
    expect(tsCount).toBeGreaterThanOrEqual(100);
    expect(nonTsCount).toBeGreaterThanOrEqual(1);
  });

  it('🔴 非TS migration が、TSで最終的に不在となったポリシーを CREATE していない', () => {
    const files = applyOrder();
    const offenders = findRollbackOffenses(files, readRepoMigration);
    if (offenders.size > 0) {
      throw new Error(
        '非タイムスタンプ migration が、タイムスタンプ付き migration 群が DROP したまま ' +
          '再 CREATE していないポリシーを CREATE しています（辞書順で最後に適用されるため ' +
          '巻き戻しになります）:\n  ' +
          [...offenders.values()].join('\n  ')
      );
    }
    expect(offenders.size).toBe(0);
  });

  it('実在する combined の21本の正規ポリシーを誤検出しない（真の陰性の確認）', () => {
    // customer_visits の2本を除去した後、combined の CREATE POLICY は21本になり、
    // その全てが「TSが一度も触れていない」または「TS最終状態=存在」のいずれかである
    // ＝ findRollbackOffenses が1件も offense を出さないことをここでも明示する
    // （上のテストと同じ結論だが、件数を明示することで巻き添え誤検出が無いことを担保する）。
    const files = applyOrder();
    const combinedFile = files.find((f) => f === 'combined_phase2_to_6.sql');
    expect(combinedFile).toBeDefined();
    const combinedCreates = extractPolicyEvents(readRepoMigration(combinedFile as string)).filter(
      (e) => e.kind === 'CREATE'
    );
    expect(combinedCreates.length).toBe(21);
    const offenders = findRollbackOffenses(files, readRepoMigration);
    expect(offenders.size).toBe(0);
  });

  it('🔴 負の対照（陽性方向）: 合成データで真の巻き戻し（DROPしたまま再CREATEしない）を検出する', () => {
    const files = ['20260101000001_a.sql', 'zzz_combined.sql'];
    const content: Record<string, string> = {
      '20260101000001_a.sql': `
        CREATE POLICY "loose_read" ON widgets FOR SELECT USING (true);
        DROP POLICY IF EXISTS "loose_read" ON widgets;
      `,
      // 非TS が DROP 済みポリシーを CREATE で復活させる = #568 の bookings 型。
      'zzz_combined.sql': `
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'widgets' AND policyname = 'loose_read') THEN
            CREATE POLICY "loose_read" ON widgets FOR SELECT USING (true);
          END IF;
        END $$;
      `,
    };
    const offenders = findRollbackOffenses(files, (f) => content[f]);
    expect(offenders.size).toBe(1);
    expect(offenders.has('widgets::loose_read')).toBe(true);
  });

  it('🔴 負の対照（陰性方向）: 合成データで DROP 後に再 CREATE 済み（customer_visits型）は検出しない', () => {
    const files = ['20260101000001_a.sql', '20260102000001_b.sql', 'zzz_combined.sql'];
    const content: Record<string, string> = {
      '20260101000001_a.sql': `
        CREATE POLICY "member_read" ON widgets FOR SELECT USING (true);
      `,
      // 後続 TS migration が DROP した上で、より厳格な役割制限版として再 CREATE 済み。
      '20260102000001_b.sql': `
        DROP POLICY IF EXISTS "member_read" ON widgets;
        CREATE POLICY "member_read" ON widgets FOR SELECT USING (role = 'owner');
      `,
      // combined は緩い旧版を CREATE しようとするが、TS最終状態=存在なので死にコード
      // （常にスキップ）であり、巻き戻しではない＝offense にならない。
      'zzz_combined.sql': `
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'widgets' AND policyname = 'member_read') THEN
            CREATE POLICY "member_read" ON widgets FOR SELECT USING (true);
          END IF;
        END $$;
      `,
    };
    const offenders = findRollbackOffenses(files, (f) => content[f]);
    expect(offenders.size).toBe(0);
  });

  it('🔴 負の対照: コメント中の CREATE/DROP POLICY を実呼出と誤検出しない', () => {
    const files = ['20260101000001_a.sql', 'zzz_combined.sql'];
    const content: Record<string, string> = {
      '20260101000001_a.sql': `
        -- CREATE POLICY "commented_out" ON widgets FOR SELECT USING (true);
        -- DROP POLICY IF EXISTS "commented_out" ON widgets;
        CREATE POLICY "real_policy" ON widgets FOR SELECT USING (true);
      `,
      'zzz_combined.sql': `
        -- DROP POLICY IF EXISTS "real_policy" ON widgets; (説明用コメント、実行はしない)
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'widgets' AND policyname = 'real_policy') THEN
            CREATE POLICY "real_policy" ON widgets FOR SELECT USING (true);
          END IF;
        END $$;
      `,
    };
    // "commented_out" はコメント内にしか存在しないので DROP イベントとして拾われず、
    // TS最終状態も定義されない。"real_policy" は一度も TS で DROP されていないので、
    // combined の CREATE は正規（offense ではない）。コメント中の DROP がもし実行扱い
    // されれば real_policy が offense になってしまうため、ここでゼロであることが
    // 「コメントを実呼出と誤認していない」ことの直接の証拠になる。
    const offenders = findRollbackOffenses(files, (f) => content[f]);
    expect(offenders.size).toBe(0);
  });
});
