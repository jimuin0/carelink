// オーナーの顧客台帳編集 E2E の共有定数。
// customers.setup.ts が CI の隔離 Supabase（supabase start）にオーナー＋施設＋顧客レコードを
// service role で seed しログインして storageState を保存。customers.spec.ts がその認証状態で
// /admin/customers を開き、顧客情報を編集→保存の書き込みを検証する。本番には一切触れない。

export const CUSTOMERS_AUTH_FILE = 'e2e/.auth/admin-customers.json';

export const CUSTOMERS_SEED = {
  // setup が seed する顧客名（spec が一覧で探して編集する）。
  customerName: 'E2E顧客台帳テスト',
  // 編集後の新しい名前。
  editedName: 'E2E顧客台帳テスト（編集済）',
};
