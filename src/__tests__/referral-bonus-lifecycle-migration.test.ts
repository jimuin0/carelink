/**
 * @jest-environment node
 *
 * 紹介ボーナスの付与・取消・入力条件（2026年10月23日）を migration の形で固定する。
 *
 * 【不具合】
 *  1. 紹介者が退会すると referral_uses が残り（referrer_user_id に FK が無い）、
 *     award_referral_points_atomic が退会済みアカウントをロックして例外になった。
 *     被紹介者の 300pt は永久に付与されず、完了のたびに Slack 警報が鳴り続けた。
 *  2. 完了した来店を「無断キャンセル」に訂正すると来店ポイントは取り消されるのに、
 *     その来店で付与した紹介ボーナス 500pt＋300pt は残った。
 *  3. 来店済みの方が後からコードを入れると「初回のご予約完了で付与」と案内されるのに、
 *     初回の完了は過ぎていて誰にも付与されなかった。
 *
 * 守るもの:
 *  - 最新定義がこの修正の migration にある（後から古い定義へ戻っていない）
 *  - 来店ポイントの関数 sync_booking_points は書き換えない。紹介ボーナスの取消は別のトリガにする。
 *    sync_booking_points は来店ポイントの上限（20261023000100_booking_visit_points_cap.sql）など
 *    他の修正も書き換えるため、ここで写しを持つと、どちらを後に適用したかで片方が黙って消える
 *  - award / apply は「タイムスタンプ順で直前の定義の写し＋追加だけ」（比較元は固定せず探す）
 *  - 付与と取消の金額・理由が対になっている（付与を変えて取消を変え忘れると落ちる）
 *  - 紹介者のロックは、取消で書き込みうる状態（付与済み）のときだけ、actor・顧客と同じ並び順の 1 回で取る
 *  - 関数の security / search_path / 権限を保ち、接続先ガードを持つ
 *  - 実 DB での検証（shadow fixture）が CI に配線されている
 *
 * この環境から SQL は実行できない。実際の挙動は
 * supabase/shadow/referral-bonus-lifecycle-fixtures.sql が CI の使い捨て PG17 で確かめる。
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const DIR = join(ROOT, 'supabase/migrations');
const LIFECYCLE = '20261023010000_referral_bonus_lifecycle.sql';
const BEFORE_FIRST_VISIT = '20261023010100_referral_code_before_first_visit.sql';
const OURS = [LIFECYCLE, BEFORE_FIRST_VISIT];

const read = (file: string) => readFileSync(join(DIR, file), 'utf8');
const MIGRATIONS = readdirSync(DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();

function definition(sql: string, fn: string): string | null {
  const m = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\([\\s\\S]*?END \\$\\$;`).exec(sql);
  return m ? m[0] : null;
}

/** タイムスタンプ順に、その関数を定義している migration の一覧。 */
function definitions(fn: string): { file: string; body: string }[] {
  return MIGRATIONS
    .map((file) => ({ file, body: definition(read(file), fn) }))
    .filter((d): d is { file: string; body: string } => d.body !== null);
}

/** タイムスタンプ順で最後にその関数を定義している migration。 */
function latest(fn: string): { file: string; body: string } {
  const defs = definitions(fn);
  expect(defs.length).toBeGreaterThan(0);
  return defs[defs.length - 1];
}

/** `file` より前（タイムスタンプ順）で最後にその関数を定義している migration。 */
function previousOf(fn: string, file: string): { file: string; body: string } {
  const defs = definitions(fn).filter((d) => d.file < file);
  expect(defs.length).toBeGreaterThan(0);
  return defs[defs.length - 1];
}

/** コメントと空白の違いを無視し、CREATE と CREATE OR REPLACE を同一視する。 */
const normalize = (sql: string) =>
  sql.replace(/--[^\n]*/g, ' ').replace(/CREATE OR REPLACE FUNCTION/g, 'CREATE FUNCTION').replace(/\s+/g, ' ').trim();

test.each([
  ['lock_booking_account_if_present', LIFECYCLE],
  ['lock_booking_point_actors', LIFECYCLE],
  ['award_referral_points_atomic', LIFECYCLE],
  ['reverse_referral_bonus_without_visit', LIFECYCLE],
  ['apply_referral_code_atomic', BEFORE_FIRST_VISIT],
])('%s の最新定義は %s', (fn, file) => {
  expect(latest(fn).file).toBe(file);
  // 最後に適用される接頭辞なしのファイルにも定義が無い（巻き戻しが起きない）。
  expect(definition(read('combined_phase2_to_6.sql'), fn)).toBeNull();
});

describe('来店ポイントの関数（sync_booking_points）を書き換えない', () => {
  test.each(OURS)('%s は sync_booking_points を定義しない', (file) => {
    // 写しを持つと、来店ポイントの上限など他の修正と適用順で上書きし合う。
    expect(definition(read(file), 'sync_booking_points')).toBeNull();
    // コメント以外（実際に実行される文）に一切現れない＝ALTER や DO ブロックでの書き換えも無い。
    expect(read(file).replace(/--[^\n]*/g, '')).not.toMatch(/sync_booking_points/);
  });

  test('紹介ボーナスの取消は bookings の別トリガ（完了から外れた更新でだけ動く）', () => {
    const trigger = /CREATE TRIGGER booking_referral_bonus_reversal[\s\S]*?;/.exec(read(LIFECYCLE));
    expect(trigger).not.toBeNull();
    const sql = trigger![0].replace(/\s+/g, ' ');
    // AFTER: 予約の新しい状態が EXISTS の判定から見える（BEFORE だと取り消す予約自身が「完了」のまま数えられる）。
    expect(sql).toContain('AFTER UPDATE OF status ON public.bookings FOR EACH ROW');
    expect(sql).toContain("WHEN (OLD.status='completed' AND NEW.status IS DISTINCT FROM 'completed' AND NEW.user_id IS NOT NULL)");
    expect(sql).toContain('EXECUTE FUNCTION public.reverse_referral_bonus_without_visit();');
  });
});

describe('退会した紹介者（award_referral_points_atomic）', () => {
  let award = '';
  beforeAll(() => { award = latest('award_referral_points_atomic').body; });

  test('紹介者は「居れば」ロックし、被紹介者は従来どおり必ずロックする', () => {
    expect(award).toMatch(/IF uid=p_user_id THEN PERFORM public\.lock_booking_account\(uid\);\s+ELSE referrer_present:=public\.lock_booking_account_if_present\(uid\); END IF;/);
    // 修正前は紹介者にも lock_booking_account を使い、退会済みだと例外で全体が巻き戻った。
    expect(previousOf('award_referral_points_atomic', LIFECYCLE).body).toMatch(/LOOP\s+PERFORM public\.lock_booking_account\(uid\);\s+END LOOP;/);
  });

  test('紹介者の 500pt だけを省き、被紹介者の 300pt は必ず付与して確定する', () => {
    expect(award).toMatch(
      /IF referrer_present THEN\s+INSERT INTO public\.user_points\(user_id,points,reason\) VALUES\(ref,500,'紹介ボーナス'\);\s+END IF;\s+INSERT INTO public\.user_points\(user_id,points,reason\) VALUES\(p_user_id,300,'紹介コード利用ボーナス'\);\s+UPDATE public\.referral_uses SET points_awarded=true WHERE id=r\.id;/,
    );
  });

  test('付与の条件（未付与・紹介者一致・完了した予約あり）は直前の定義のまま', () => {
    const previous = previousOf('award_referral_points_atomic', LIFECYCLE).body;
    for (const line of [
      'IF NOT FOUND OR r.points_awarded THEN RETURN false; END IF;',
      "IF r.referrer_user_id IS DISTINCT FROM ref THEN RAISE EXCEPTION 'REFERRAL_REVISION_CONFLICT'; END IF;",
      "IF NOT EXISTS(SELECT 1 FROM public.bookings WHERE user_id=p_user_id AND status='completed') THEN RETURN false; END IF;",
    ]) {
      expect(previous).toContain(line);
      expect(award).toContain(line);
    }
  });

  test('居ないアカウントは例外にせず false を返すロック', () => {
    const lock = latest('lock_booking_account_if_present').body;
    expect(lock).toContain('PERFORM id FROM auth.users WHERE id=p_user_id FOR KEY SHARE;');
    expect(lock).toContain('IF NOT FOUND THEN RETURN false; END IF;');
    expect(lock).not.toContain('RAISE');
    // lock_booking_account と同じ鍵（同じアカウントの直列化）を使う。
    const strict = latest('lock_booking_account').body;
    const key = "pg_advisory_xact_lock(hashtextextended('carelink-points:'||p_user_id::text,0))";
    expect(strict).toContain(key);
    expect(lock).toContain(key);
  });
});

describe('来店の取消で紹介ボーナスも取り消す（booking_referral_bonus_reversal）', () => {
  let reverse = '';
  let award = '';
  beforeAll(() => {
    reverse = latest('reverse_referral_bonus_without_visit').body;
    award = latest('award_referral_points_atomic').body;
  });

  test('完了した予約が 1 件も残らないときだけ取り消し、再付与できるよう未付与へ戻す', () => {
    expect(reverse).toContain("IF NEW.user_id IS NULL OR OLD.status IS DISTINCT FROM 'completed' OR NEW.status='completed' THEN RETURN NULL; END IF;");
    expect(reverse).toContain('PERFORM public.lock_booking_account(NEW.user_id);');
    expect(reverse).toContain('IF NOT FOUND OR r.points_awarded IS NOT TRUE THEN RETURN NULL; END IF;');
    expect(reverse).toContain("IF EXISTS(SELECT 1 FROM public.bookings WHERE user_id=NEW.user_id AND status='completed') THEN RETURN NULL; END IF;");
    expect(reverse).toContain('UPDATE public.referral_uses SET points_awarded=false WHERE id=r.id;');
    // 退会済みの紹介者は飛ばす（ロック失敗で無断キャンセルへの訂正まで止めない）。
    expect(reverse).toMatch(/IF public\.lock_booking_account_if_present\(r\.referrer_user_id\) THEN\s+INSERT INTO public\.user_points\(user_id,points,reason\) VALUES\(r\.referrer_user_id,/);
  });

  test('取消は付与と同じ額・同じ理由の打ち消し（履歴を消さない）', () => {
    const credit = (who: string) => {
      const m = new RegExp(`VALUES\\(${who},(\\d+),'([^']+)'\\)`).exec(award);
      expect(m).not.toBeNull();
      return { points: Number(m![1]), reason: m![2] };
    };
    const referrer = credit('ref');
    const referred = credit('p_user_id');
    expect(reverse).toContain(`VALUES(r.referrer_user_id,-${referrer.points},'${referrer.reason}取消')`);
    expect(reverse).toContain(`VALUES(NEW.user_id,-${referred.points},'${referred.reason}取消')`);
    expect(reverse).not.toMatch(/DELETE FROM public\.user_points/);
  });

  test('紹介者は付与済みのときだけ、actor・顧客と同じ並び順の 1 回でロックする', () => {
    const actors = latest('lock_booking_point_actors').body;
    // 取消が紹介者へ書き込むのは付与済み（points_awarded）のときだけ。それ以外の紹介でロックを広げない
    // （同じ人が紹介した全員の予約操作が、その人 1 人のロックで直列化されるのを避ける）。
    expect(actors).toMatch(/SELECT u\.referrer_user_id INTO ref FROM public\.referral_uses u\s+WHERE u\.referred_user_id=p_customer_id AND u\.points_awarded IS TRUE;/);
    expect(reverse).toContain('IF NOT FOUND OR r.points_awarded IS NOT TRUE THEN RETURN NULL; END IF;');
    expect(actors).toContain('FOR uid IN SELECT DISTINCT x FROM unnest(ARRAY[p_actor_id,p_customer_id,ref]) x WHERE x IS NOT NULL ORDER BY x LOOP');
    expect(actors).toMatch(/IF uid IS NOT DISTINCT FROM p_actor_id OR uid IS NOT DISTINCT FROM p_customer_id THEN\s+PERFORM public\.lock_booking_account\(uid\);\s+ELSE\s+PERFORM public\.lock_booking_account_if_present\(uid\);/);
    // 無断キャンセルへの訂正（save_booking_email_event_atomic）は、トリガより前にこれで顧客をロックしている。
    expect(latest('save_booking_email_event_atomic').body).toContain('PERFORM public.lock_booking_point_actors(p_actor_id,point_user);');
  });

  test('actor・顧客のロックは直前の定義と同じ（lock_booking_account）', () => {
    expect(previousOf('lock_booking_point_actors', LIFECYCLE).body).toMatch(/LOOP\s+PERFORM public\.lock_booking_account\(uid\);\s+END LOOP;/);
  });
});

describe('来店済みの方のコード入力（apply_referral_code_atomic）', () => {
  let apply = '';
  beforeAll(() => { apply = latest('apply_referral_code_atomic').body; });
  const ADDED = /\s*-- The first completed visit has already happened: the bonus can no longer be earned\.\s*IF EXISTS\(SELECT 1 FROM public\.bookings b WHERE b\.user_id=p_user_id AND b\.status='completed'\)\s*THEN RAISE EXCEPTION 'REFERRAL_NOT_ELIGIBLE'; END IF;/;

  test('既存の適用の再送は従来どおり答え、新しい適用の記録より前に断る', () => {
    const replay = apply.indexOf('RETURN QUERY SELECT u.id,u.code,true; RETURN;');
    const refuse = apply.indexOf("RAISE EXCEPTION 'REFERRAL_NOT_ELIGIBLE'");
    const insert = apply.indexOf('INSERT INTO public.referral_uses');
    expect(replay).toBeGreaterThan(0);
    expect(refuse).toBeGreaterThan(replay);
    expect(insert).toBeGreaterThan(refuse);
    // 完了経路と同じ顧客ロックの内側で判定する。
    expect(apply.indexOf('PERFORM public.lock_booking_point_actors(p_user_id,owner_id);')).toBeLessThan(refuse);
  });

  test('追加した判定以外は直前の定義の写し', () => {
    expect(apply).toMatch(ADDED);
    const previous = previousOf('apply_referral_code_atomic', BEFORE_FIRST_VISIT).body;
    expect(normalize(apply.replace(ADDED, ''))).toBe(normalize(previous));
  });

  test('API が REFERRAL_NOT_ELIGIBLE を理由つきの 400 にする（500 や「付与されます」にしない）', () => {
    const route = readFileSync(join(ROOT, 'src/app/api/referral/route.ts'), 'utf8');
    expect(route).toContain("applied.error.message === 'REFERRAL_NOT_ELIGIBLE'");
  });
});

describe('権限・security・接続先ガード', () => {
  test.each(OURS)('%s は最初に CareLink の DB かを確かめる', (file) => {
    const statements = read(file).replace(/--[^\n]*/g, '').trim();
    expect(statements.startsWith("DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;")).toBe(true);
  });

  const header = (body: string) => body.slice(0, body.indexOf(' AS $$'));
  test.each([
    ['lock_booking_point_actors', LIFECYCLE],
    ['award_referral_points_atomic', LIFECYCLE],
    ['apply_referral_code_atomic', BEFORE_FIRST_VISIT],
  ])('%s は security と search_path を変えない', (fn, file) => {
    const previous = previousOf(fn, file).body;
    const mode = (h: string) => /SECURITY (DEFINER|INVOKER)/.exec(h)?.[1];
    expect(mode(header(latest(fn).body))).toBe(mode(header(previous)));
    expect(header(latest(fn).body)).toContain("SET search_path=''");
  });

  test.each([
    [LIFECYCLE, 'lock_booking_account_if_present(uuid)'],
    [LIFECYCLE, 'lock_booking_point_actors(uuid,uuid)'],
    [LIFECYCLE, 'award_referral_points_atomic(uuid)'],
    [BEFORE_FIRST_VISIT, 'apply_referral_code_atomic(uuid,text)'],
  ])('%s: %s はサーバーだけが実行できる', (file, signature) => {
    const sql = read(file);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC,anon,authenticated;`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
  });

  test('取消のトリガ関数はトリガからだけ届く（service_role にも開けない）', () => {
    const sql = read(LIFECYCLE);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.reverse_referral_bonus_without_visit() FROM PUBLIC,anon,authenticated,service_role;');
    expect(sql).not.toContain('GRANT EXECUTE ON FUNCTION public.reverse_referral_bonus_without_visit');
  });

  test('新しい関数は SECURITY DEFINER と search_path 固定', () => {
    for (const fn of ['lock_booking_account_if_present', 'reverse_referral_bonus_without_visit']) {
      expect(header(latest(fn).body)).toMatch(/SECURITY DEFINER SET search_path=''/);
    }
  });
});

test('実 DB での検証（shadow fixture）が CI に配線されている', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/schema-fingerprint.yml'), 'utf8');
  expect(workflow).toContain('-d carelink_shadow -f supabase/shadow/referral-bonus-lifecycle-fixtures.sql');
  const fixture = readFileSync(join(ROOT, 'supabase/shadow/referral-bonus-lifecycle-fixtures.sql'), 'utf8');
  expect(fixture).toContain("IF SQLERRM <> 'REFERRAL_NOT_ELIGIBLE' THEN RAISE; END IF;");
  expect(fixture).toContain("'紹介ボーナス取消'");
  expect(fixture).toContain("'紹介コード利用ボーナス取消'");
  expect(fixture).toContain("'来店ポイント取消'");
  expect(fixture).toContain("DELETE FROM auth.users WHERE id = 'fd210000-0000-4000-8000-000000000005';");
  // ロックの範囲（付与前の紹介者はロックしない／付与済みならロックする）を実 DB の pg_locks で確かめる。
  expect(fixture).toContain("'a referrer whose bonus is not granted is not locked by the customer''s booking operations'");
  expect(fixture).toContain("'a granted bonus locks its referrer in the same sorted pass'");
  expect(fixture.trimEnd().endsWith('ROLLBACK;')).toBe(true);
});
