// オーナーのサブスク契約者ステータス変更 E2E の共有定数。
// admin-subscribers.setup.ts が CI の隔離 Supabase（supabase start）にオーナー＋施設＋契約者
// （customer user + その店舗での予約 + アクティブな user_subscription）を service role で seed しログインして
// storageState を保存。admin-subscribers.spec.ts がその認証状態で /admin/subscription-plans の
// 契約者一覧から「一時停止」操作を検証する。本番には一切触れない。

export const SUBSCRIBERS_AUTH_FILE = 'e2e/.auth/admin-subscribers.json';

export const SUBSCRIBERS_SEED = {
  planName: 'E2E契約者検証プラン',
  // 契約者の表示名。契約者一覧はこの名前を、その店舗の予約者に限って返す
  // （RPC list_facility_customer_profiles）。予約が無い契約者は「不明」になる。
  subscriberName: 'E2E契約者',
};
