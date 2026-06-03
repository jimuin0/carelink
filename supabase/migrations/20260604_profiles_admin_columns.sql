-- profiles の管理者判定列の定義を補完（scale監査・スキーマドリフト是正）
--
-- 事実: 多数のコード(.select('is_platform_admin'))と RLS（feature_flags / white_label / audit_log 等で
--   EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND role='admin') / is_platform_admin = TRUE）が
--   profiles.role / profiles.is_platform_admin を参照しているが、これらの列を profiles に追加する
--   マイグレーションがリポジトリに存在しなかった（本番には手動追加されている前提で稼働中）。
--   このままだと新環境（ステージング/別リージョン/災害復旧）を migration から構築した際に、
--   列が無く RLS 作成失敗 or API の .select 失敗 → プラットフォーム管理機能が停止する。
--
-- 対策: 冪等(ADD COLUMN IF NOT EXISTS)で列を定義。本番は既存のため no-op、新環境では作成される。
-- 既定は fail-closed（is_platform_admin=FALSE / role=NULL）＝明示付与するまで管理者権限は付かない。
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT;

-- 参照高速化（管理者判定 EXISTS の where で使われる）
CREATE INDEX IF NOT EXISTS idx_profiles_platform_admin ON profiles(id) WHERE is_platform_admin = TRUE;
