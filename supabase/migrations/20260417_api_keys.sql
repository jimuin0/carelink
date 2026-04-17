-- 外部API用APIキー管理テーブル
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                      -- キー識別名（例: "POS連携"）
  key_hash TEXT NOT NULL UNIQUE,           -- SHA256(raw_key) で保存
  key_prefix TEXT NOT NULL,               -- 表示用プレフィックス（例: "ck_live_xxxx"）
  scopes TEXT[] NOT NULL DEFAULT '{}',    -- 例: ['bookings:read', 'customers:read']
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_facility ON api_keys(facility_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- オーナー・管理者のみ
CREATE POLICY "api_keys_facility_member" ON api_keys
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM facility_members fm
      WHERE fm.facility_id = api_keys.facility_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner', 'admin')
    )
  );
