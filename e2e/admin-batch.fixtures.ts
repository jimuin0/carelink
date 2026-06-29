// オーナー設定保存／パッケージ作成 E2E の共有定数。
// admin-batch.setup.ts が CI の隔離 Supabase（supabase start）にオーナー＋施設を service role で
// seed しログインして storageState を保存。admin-settings.spec.ts と admin-packages.spec.ts が
// その認証状態で /admin/settings・/admin/packages を検証する（どちらも owner 認証のみ必要なため
// setup を共有する）。本番には一切触れない。

export const ADMIN_BATCH_AUTH_FILE = 'e2e/.auth/admin-batch.json';
