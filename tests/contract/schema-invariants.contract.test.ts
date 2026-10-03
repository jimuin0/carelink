/**
 * @jest-environment node
 *
 * Supabase staging スキーマ不変条件テスト（Phase 2 Contract / ドリフト恒久ガード）。
 *
 * 目的:
 *   2026-04〜06 に頻発した「本番 DB と repo migration の静かなドリフト」
 *   （RPC 不在 / カラム欠落 / View 未作成 / RLS の過大公開 / 予約 RPC の 0A000 landmine）
 *   を、症状が出る前（発症前）に CI で検知する恒久ガード層。
 *   rpc-probe.test.ts / booking-e2e-manual.test.ts という一時スクラッチで都度確認していた
 *   作業を、staging-gated の常設テストへ昇格させたもの。
 *
 * 実行条件:
 *   STAGING_SUPABASE_URL + STAGING_SUPABASE_ANON_KEY が設定された環境でのみ実行。
 *   全読取を実行するため STAGING_SUPABASE_SERVICE_ROLE_KEY も必須。
 *   明示した3入力が欠けると失敗。CIは未設定の外部環境へ実行しない。
 *
 * 読取契約10件のみ。書込み/RPC拒否5件はlocal-mutation.contract.test.tsへ分離。
 * 実本番への接続は禁止。
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.STAGING_SUPABASE_URL;
const ANON = process.env.STAGING_SUPABASE_ANON_KEY;
const SRK = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SRK) throw new Error('Explicit Supabase URL, anon and service credentials required for all read contracts');

if (new globalThis.URL(URL!).hostname === 'xzafxiupbflvgbarrihe.supabase.co') throw new Error('Production target is forbidden for contract execution');

// 環境は上のguardで明示確認済み。
const anon = URL && ANON ? createClient(URL, ANON) : (null as never);

describe('schema invariants (configured Supabase)', () => {

  // ── 1. オブジェクト存在: RPC が schema cache に存在する（PGRST202 でない） ──
  describe('RPC 存在', () => {
    test('search_facilities_nearby が存在し実行できる', async () => {
      const { data, error } = await anon.rpc('search_facilities_nearby', {
        user_lat: 0,
        user_lng: 0,
        radius_km: 1,
        type_filter: null,
        limit_count: 1,
      });
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  // 空DBの[]はRLSの有効性を証明しない。この層はAPI/列契約と、存在する行の非公開確認。
  // tenant境界全体の保証にはロール別の合成行fixtureが別途必要。
  describe('anon SELECTのAPI/列契約（空DBではRLS証明にならない）', () => {
    test('facility_reviews の直接 SELECT はanonに行を返さない', async () => {
      // anon は public_reviews 経由でのみ読むべき。直接テーブルからは 0 行であるべき。
      const { data, error } = await anon
        .from('facility_reviews')
        .select('id')
        .limit(1);
      if (error) expect(error.code).toBe('42501');
      else expect(data).toEqual([]);
    });

    test('public_reviews は anon が読め、reviewer_ip 列を含まない', async () => {
      const { error: ipError } = await anon
        .from('public_reviews')
        .select('reviewer_ip')
        .limit(1);
      // reviewer_ip は View に存在しないため、選択するとエラーになるべき。
      expect(ipError?.code).toBe('42703');

      // 公開列のみなら読める（行数は問わない）。
      const { error: okError } = await anon
        .from('public_reviews')
        .select('id,facility_id,reviewer_name,rating,comment,status,created_at')
        .limit(1);
      expect(okError).toBeNull();
    });

    test('referral_codes の直接 SELECT はanonに行を返さない', async () => {
      const { data, error } = await anon
        .from('referral_codes')
        .select('id')
        .limit(1);
      // 公開 SELECT ポリシーは drop 済み。RLS で弾かれる or 0 行であるべき。
      if (error) expect(error.code).toBe('42501');
      else expect(data).toEqual([]);
    });
  });

  // ── 2b. RLS 不変条件: anon の直接 INSERT が拒否される（攻撃面の封鎖確認） ──
  // 20260602 の RLS ハードニング（contacts 撤去 / push_subscriptions 本人限定 /
  // intake・waitlist 詐称封鎖 / nps anon 撤去）のfresh-apply結果を隔離DBで確認する。
  // ── 2c. 型ドリフト恒久ガード: /api/salons が送る値の型と salons の実列型 ──
  //
  // 背景（docs/register-blocker-instructions.md）:
  //   /register の「掲載希望時期」は列挙文字列（'immediately' 等）を送るが、
  //   salons.desired_start_date は元 date 型だったため INSERT が
  //   ERROR 22007 invalid input syntax for type date で必ず失敗していた
  //   （PG16 の使い捨てDBで実測確定・PostgREST 形でも再現済み）。
  //   supabase/migrations/20260820000001_salons_desired_start_date_to_text.sql で
  //   text へ変更したが、これが本番へ適用され忘れる／将来また date 系へ戻される
  //   （逆ドリフト）と、この不具合は無音で再発する。
  //
  // 検証方法（読み取りのみ・INSERT しない）:
  //   等号フィルタ `.eq('desired_start_date', 'immediately')` を持つ SELECT を投げる。
  //   PostgREST はこのフィルタを `WHERE desired_start_date = 'immediately'` に変換するため、
  //   列が date 型なら Postgres がリテラルを date へ暗黙キャストしようとして
  //   `invalid input syntax for type date`（SQLSTATE 22007）で例外になる。text 型なら
  //   キャストが発生せず、0件以上の通常応答になる。
  //   🔴 この型エラーは RLS の可否より前（parse/analyze 段階）で発生するため、
  //     salons に anon 向け SELECT ポリシーが無く常に 0 行しか返らない環境でも
  //     機能する（実測: ローカル PostgreSQL 16 で「RLS 全拒否・SELECT 権限のみ」の
  //     テーブルに対し、date 列は 22007 で例外・text 列は 0 行応答、を確認して
  //     このテストの土台にしている）。
  //   これにより行を1件も作らずに実列型を判定できる（INSERT でしか確かめられない
  //   形は avoid する、という指示書の方針に沿う）。
  //
  // 負の対照（このテストの中に内蔵）:
  //   desired_start_date が date 型に戻った場合、Supabase は error.code='22007' を返し、
  //   `expect(error).toBeNull()` が失敗して本テストが red になる。
  describe('型ドリフト恒久ガード（salons.desired_start_date）', () => {
    test('申込の施設取込先と審査revision列が存在する（実レコードは取得しない）', async () => {
      const { data, error } = await anon
        .from('salons')
        .select('claimed_facility_id,review_revision')
        .limit(0);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    test('salons.desired_start_date は列挙文字列を受け付ける型である（date へ逆戻りしていない）', async () => {
      const { error } = await anon
        .from('salons')
        .select('id')
        .eq('desired_start_date', 'immediately')
        .limit(1);

      if (error) {
        // date 型に戻った場合に踏む具体的なエラー形（デバッグ時に読めばすぐ分かるように明示する）。
        expect(error.code).not.toBe('22007');
        expect(error.message).not.toMatch(/invalid input syntax for type date/i);
      }
      expect(error).toBeNull();
    });
  });

  // ── 3. カラム/View 存在（service_role があれば確定的に検証） ──
  describe('カラム/View 存在（service_role）', () => {
    // 上と同様、未設定時に createClient が throw しないよう設定済みのときだけ生成。
    const admin = URL && SRK ? createClient(URL, SRK) : (null as never);

    test('facility_profiles に google_rating / google_review_count が存在', async () => {
      const { error } = await admin
        .from('facility_profiles')
        .select('google_rating,google_review_count')
        .limit(0);
      expect(error).toBeNull();
    });

    test('facility_card_view が存在し主要列を含む', async () => {
      const { error } = await admin
        .from('facility_card_view')
        .select('id,slug,name,google_rating,google_review_count')
        .limit(0);
      expect(error).toBeNull();
    });

    test('facility_reviews に flagging 列（reviewer_ip/is_flagged/flag_reason）が存在', async () => {
      const { error } = await admin
        .from('facility_reviews')
        .select('reviewer_ip,is_flagged,flag_reason')
        .limit(0);
      expect(error).toBeNull();
    });

    test('slack_incident_threads / rate_limit_buckets が存在', async () => {
      const { error: t1 } = await admin.from('slack_incident_threads').select('*').limit(0);
      const { error: t2 } = await admin.from('rate_limit_buckets').select('*').limit(0);
      expect(t1).toBeNull();
      expect(t2).toBeNull();
    });
  });
});
