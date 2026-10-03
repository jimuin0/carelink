/** @jest-environment node */
// 書込みが成功すると副作用が生じる5probe。隔離loopback以外は実行前に拒否。
import { createClient } from '@supabase/supabase-js';
const URL = process.env.STAGING_SUPABASE_URL;
const ANON = process.env.STAGING_SUPABASE_ANON_KEY;
const SRK = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/?$/.test(URL) || !ANON || !SRK) {
  throw new Error('Local mutation contracts require isolated loopback and explicit credentials');
}
new globalThis.URL(URL);
const anon = createClient(URL, ANON);
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
describe('isolated local mutation contracts', () => {
    test('enqueue_moderation はanonを拒否し、serviceの空batchは0件（隔離local）', async () => {
      const denied = await anon.rpc('enqueue_moderation', { p_items: [] });
      expect(denied.error?.code).toBe('42501');
      const admin = createClient(URL!, SRK!);
      const allowed = await admin.rpc('enqueue_moderation', { p_items: [] });
      expect(allowed.error).toBeNull();
      expect(allowed.data).toBe(0);
    });

    test('create_booking_atomic はanonを拒否し、service_roleは既知の予約拒否へ到達する（隔離local）', async () => {
      const args = {
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
      };
      const denied = await anon.rpc('create_booking_atomic', args);
      expect(denied.error?.code).toBe('42501');
      const admin = createClient(URL!, SRK!);
      const { error } = await admin.rpc('create_booking_atomic', args);
      // 存在しない施設には勤務スタッフがいないため、現行関数はFKより前に拒否する。
      // この経路の実到達だけを検証。予約成功/別分岐はbooking E2Eが補完する。
      expect(error?.code).toBe('P0001');
      expect(error?.message).toMatch(/^BOOKING_CONFLICT:/);
    });

  describe('RLS 不変条件（隔離localでanonの直接INSERT拒否）', () => {
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
      expect(error?.code).toBe('42501');
    });

    test('push_subscriptions への anon 直接 INSERT は拒否される（本人のみ）', async () => {
      // 統合ポリシー push_subscriptions_owner_all は auth.uid() = user_id を要求。
      // anon は auth.uid() = null のため WITH CHECK で拒否される。
      // FK違反ではなく、RLS/権限が先に拒否したことを確認する。
      const { error } = await anon
        .from('push_subscriptions')
        .insert({
          user_id: ZERO_UUID,
          endpoint: 'https://example.invalid/contract-probe',
          p256dh: 'contract-probe',
          auth: 'contract-probe',
        });
      expect(error?.code).toBe('42501');
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
      expect(error?.code).toBe('42501');
    });
  });

});
