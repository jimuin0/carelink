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
 *   service_role 限定オブジェクトは STAGING_SUPABASE_SERVICE_ROLE_KEY があれば追加検証。
 *   未設定時は describe.skip（本番リソースには絶対に触らない）。
 *
 * 副作用ゼロ設計:
 *   - SELECT は .limit(0/1) のみ（行を変更しない）。
 *   - RPC は zero-UUID / 存在しないキーで呼び、FK 違反(23503) や PGRST で
 *     本体実行前にエラーさせる（永続化しない）。
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.STAGING_SUPABASE_URL;
const ANON = process.env.STAGING_SUPABASE_ANON_KEY;
const SRK = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;

const describeIfConfigured = URL && ANON ? describe : describe.skip;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

// describe.skip でも describe の body は評価されるため、未設定環境で createClient が
// 'supabaseUrl is required' を投げないよう、設定済みのときだけ生成する（遅延・null許容）。
const anon = URL && ANON ? createClient(URL, ANON) : (null as never);

describeIfConfigured('schema invariants (staging)', () => {

  // ── 1. オブジェクト存在: RPC が schema cache に存在する（PGRST202 でない） ──
  describe('RPC 存在', () => {
    test('create_booking_atomic が存在し 0A000 landmine が無い', async () => {
      // zero-UUID の facility_id は bookings.facility_id FK に違反するため、
      // 関数が正しく動いていれば INSERT 時に 23503 で落ちる。
      // 0A000（FOR UPDATE + 集約）なら COUNT クエリのプラン時に落ちる＝landmine 再発。
      const { error } = await anon.rpc('create_booking_atomic', {
        p_facility_id: ZERO_UUID,
        p_staff_id: null,
        p_user_id: null,
        p_menu_id: null,
        p_coupon_id: null,
        p_booking_date: '2099-01-01',
        p_start_time: '00:00',
        p_end_time: '00:30',
        p_customer_name: 'contract-probe',
        p_email: 'contract-probe@example.invalid',
        p_phone: '09000000000',
        p_note: null,
        p_total_price: 0,
        p_points_used: 0,
        p_status: 'pending',
      });
      expect(error).not.toBeNull();
      // 存在しない（PGRST202）は不可
      expect(error!.code).not.toBe('PGRST202');
      // 0A000 landmine（FOR UPDATE + 集約）が repo に書き戻されたら即検知
      expect(error!.code).not.toBe('0A000');
      expect(error!.message).not.toMatch(/FOR UPDATE is not allowed with aggregate/i);
      // 期待挙動: FK 違反で本体実行前に弾かれる
      expect(error!.code).toBe('23503');
    });

    test('search_facilities_nearby が存在し実行できる', async () => {
      const { error } = await anon.rpc('search_facilities_nearby', {
        user_lat: 0,
        user_lng: 0,
        radius_km: 1,
        type_filter: null,
        limit_count: 1,
      });
      // 実行できれば error は null。PGRST202（不在）なら失敗。
      if (error) expect(error.code).not.toBe('PGRST202');
    });
  });

  // ── 2. RLS 不変条件: anon が過大公開されていない ──
  describe('RLS 不変条件（anon）', () => {
    test('facility_reviews の直接 SELECT は anon に行を返さない（PII 漏洩防止）', async () => {
      // anon は public_reviews 経由でのみ読むべき。直接テーブルからは 0 行であるべき。
      const { data, error } = await anon
        .from('facility_reviews')
        .select('id')
        .limit(1);
      // RLS で弾かれる（error）か、空配列のどちらか。行が返ってきたら過大公開。
      if (!error) {
        expect(Array.isArray(data)).toBe(true);
        expect(data!.length).toBe(0);
      }
    });

    test('public_reviews は anon が読め、reviewer_ip 列を含まない', async () => {
      const { error: ipError } = await anon
        .from('public_reviews')
        .select('reviewer_ip')
        .limit(1);
      // reviewer_ip は View に存在しないため、選択するとエラーになるべき。
      expect(ipError).not.toBeNull();

      // 公開列のみなら読める（行数は問わない）。
      const { error: okError } = await anon
        .from('public_reviews')
        .select('id,facility_id,reviewer_name,rating,comment,status,created_at')
        .limit(1);
      expect(okError).toBeNull();
    });

    test('referral_codes は anon に公開読み取りされない', async () => {
      const { data, error } = await anon
        .from('referral_codes')
        .select('id')
        .limit(1);
      // 公開 SELECT ポリシーは drop 済み。RLS で弾かれる or 0 行であるべき。
      if (!error) {
        expect(Array.isArray(data)).toBe(true);
        expect(data!.length).toBe(0);
      }
    });
  });

  // ── 2b. RLS 不変条件: anon の直接 INSERT が拒否される（攻撃面の封鎖確認） ──
  // 20260602 の RLS ハードニング（contacts 撤去 / push_subscriptions 本人限定 /
  // intake・waitlist 詐称封鎖 / nps anon 撤去）が本番へ反映されているかを検知する。
  describe('RLS 不変条件（anon の直接 INSERT 拒否）', () => {
    test('contacts への anon 直接 INSERT は拒否される（送信は service_role 経由のみ）', async () => {
      // contacts は INSERT ポリシーを持たない（deny by default）。
      // 正規の問い合わせ送信は API が service_role で行うため anon 直接 INSERT は不要。
      // 万一ポリシーが復活（WITH CHECK(true)）すると本テストが失敗し回帰を検知する。
      const { error } = await anon
        .from('contacts')
        .insert({
          name: 'contract-probe',
          email: 'contract-probe@example.invalid',
          inquiry_type: 'other',
          message: 'contract drift probe (should be rejected by RLS)',
        });
      // RLS で弾かれる（42501 等）はず。null（成功）なら過大公開の回帰。
      expect(error).not.toBeNull();
    });

    test('push_subscriptions への anon 直接 INSERT は拒否される（本人のみ）', async () => {
      // 統合ポリシー push_subscriptions_owner_all は auth.uid() = user_id を要求。
      // anon は auth.uid() = null のため WITH CHECK で拒否される。
      // さらに user_id = ZERO_UUID は auth.users に存在せず FK(23503) でも弾かれるため、
      // 仮に RLS をすり抜けても行は永続化しない（副作用ゼロ）。
      const { error } = await anon
        .from('push_subscriptions')
        .insert({
          user_id: ZERO_UUID,
          endpoint: 'https://example.invalid/contract-probe',
          p256dh: 'contract-probe',
          auth: 'contract-probe',
        });
      expect(error).not.toBeNull();
    });

    test('nps_surveys への anon 直接 INSERT は拒否される（service_role 経由のみ）', async () => {
      // nps_own_insert 撤去後は INSERT ポリシー不在 = deny by default。
      // 正規の NPS 登録は API が service_role で行う。
      const { error } = await anon
        .from('nps_surveys')
        .insert({
          score: 0,
          comment: 'contract drift probe (should be rejected by RLS)',
          category: 'overall',
        });
      expect(error).not.toBeNull();
    });
  });

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
      expect(
        error,
        `salons.desired_start_date への等号フィルタが失敗した（type=${error?.code ?? '?'}）。` +
          'date 型へ逆戻りした（=今回の実障害の再発）疑いがある。',
      ).toBeNull();
    });
  });

  // ── 3. カラム/View 存在（service_role があれば確定的に検証） ──
  (URL && SRK ? describe : describe.skip)('カラム/View 存在（service_role）', () => {
    // 上と同様、未設定時に createClient が throw しないよう設定済みのときだけ生成。
    const admin = URL && SRK ? createClient(URL, SRK) : (null as never);

    test('facility_profiles に google_rating / google_review_count が存在', async () => {
      const { error } = await admin
        .from('facility_profiles')
        .select('google_rating,google_review_count')
        .limit(1);
      expect(error).toBeNull();
    });

    test('facility_card_view が存在し主要列を含む', async () => {
      const { error } = await admin
        .from('facility_card_view')
        .select('id,slug,name,google_rating,google_review_count')
        .limit(1);
      expect(error).toBeNull();
    });

    test('facility_reviews に flagging 列（reviewer_ip/is_flagged/flag_reason）が存在', async () => {
      const { error } = await admin
        .from('facility_reviews')
        .select('reviewer_ip,is_flagged,flag_reason')
        .limit(1);
      expect(error).toBeNull();
    });

    test('slack_incident_threads / rate_limit_buckets が存在', async () => {
      const { error: t1 } = await admin.from('slack_incident_threads').select('*').limit(1);
      const { error: t2 } = await admin.from('rate_limit_buckets').select('*').limit(1);
      expect(t1).toBeNull();
      expect(t2).toBeNull();
    });
  });
});
