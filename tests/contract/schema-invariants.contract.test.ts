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
