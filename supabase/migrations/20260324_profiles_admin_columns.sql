-- profiles 管理者カラム補完（2026-03-24 / 順序: profiles 作成=20260323 の直後）
--
-- 背景（事実）:
--   profiles テーブル（20260323_phase2_users_search.sql で作成）には role /
--   is_platform_admin カラムが存在しない。一方、20260417_* 以降の多数の RLS
--   ポリシーと src/app/admin/* の管理画面コードは両カラムを参照する:
--     - role = 'admin'            … 監査ログ等の管理者限定 RLS
--     - is_platform_admin = TRUE  … プラットフォーム管理機能のゲート
--   このカラム欠落により、20260417_* の CREATE POLICY が fresh replay 時に
--   42703 (column does not exist) で失敗する landmine だった（2026-06-03 本番
--   catch-up apply で実証）。
--
-- 対応:
--   profiles 作成直後にあたる本 migration で両カラムを冪等に追加する。
--   既定値は「誰も管理者でない」安全側。実際の管理者へは適用後に手動付与する
--   （例: UPDATE profiles SET is_platform_admin = TRUE, role = 'admin' WHERE id = '<uuid>';）。
--   ADD COLUMN IF NOT EXISTS は冪等で、既存値を保持する（再適用しても no-op）。
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;
