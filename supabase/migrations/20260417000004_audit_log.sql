-- 監査ログ（v8.33）
-- 誰が何をいつ変更したかを記録するaudit_logsテーブル
-- 施設プロフィール・予約・スタッフ等の重要操作をトラッキング

CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  facility_id  UUID,
  action       TEXT NOT NULL,
  table_name   TEXT NOT NULL,
  record_id    TEXT,
  old_values   JSONB,
  new_values   JSONB,
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 検索用インデックス
CREATE INDEX IF NOT EXISTS idx_audit_logs_facility ON audit_logs (facility_id, created_at DESC) WHERE facility_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON audit_logs (table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);

-- 90日以上前のログを自動削除
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs()
RETURNS VOID AS $$
BEGIN
  DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 管理者は全件閲覧可
CREATE POLICY "audit_logs_admin_read" ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 施設メンバーは自施設の監査ログのみ閲覧可
CREATE POLICY "audit_logs_facility_member_read" ON audit_logs FOR SELECT USING (
  facility_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM facility_members
    WHERE facility_id = audit_logs.facility_id
      AND user_id = auth.uid()
  )
);

-- INSERT は service role のみ（RLS bypass）
COMMENT ON TABLE audit_logs IS '重要操作の監査ログ。90日で自動削除。action: create/update/delete/login/logout等';
COMMENT ON COLUMN audit_logs.action IS 'create, update, delete, login, logout, publish, suspend, verify, approve, reject';
COMMENT ON COLUMN audit_logs.old_values IS 'UPDATE前の値（変更されたフィールドのみ）';
COMMENT ON COLUMN audit_logs.new_values IS 'UPDATE後の値（変更されたフィールドのみ）';
