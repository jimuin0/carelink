// オーナー（店舗管理者）のキャンセル／無断キャンセル E2E の共有定数。
// owner-cancel.setup.ts が CI の隔離 Supabase（supabase start）にテスト店舗＋オーナー＋
// キャンセル対象の予約を service role で seed し、owner-cancel.spec.ts が実 UI 上で
// ステータス変更（キャンセル／無断キャンセル）の書き込みを検証する。本番には一切触れない。

export const OWNER_AUTH_FILE = 'e2e/.auth/owner-cancel.json';
// setup が seed した各予約 id を書き出すファイル（spec が読んで予約詳細を開く）。
export const OWNER_PENDING_FILE = 'e2e/.auth/owner-cancel-pending.json';     // pending → お断り(cancelled)
export const OWNER_CONFIRMED_FILE = 'e2e/.auth/owner-cancel-confirmed.json'; // confirmed → cancelled
export const OWNER_NOSHOW_FILE = 'e2e/.auth/owner-cancel-noshow.json';       // confirmed → no_show

export const OWNER_SEED = {
  staffName: '佐藤 花子',
  pendingCustomer: 'キャンセルE2E承認待ち',
  confirmedCustomer: 'キャンセルE2E確定',
  noShowCustomer: '無断E2E確定',
};
