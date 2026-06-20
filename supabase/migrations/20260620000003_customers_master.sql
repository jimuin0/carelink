-- 顧客マスター（手入力で追加・編集できる顧客台帳）
-- 既存の customer_visits（予約完了から自動で積まれる来店ログ）は「来店実績」専用で編集不可だった。
-- 本テーブルは店舗が手入力で顧客を追加・編集・削除できるマスターで、顧客一覧では
-- email（正規化）で来店ログと突合して「来店回数・最終来店」を合わせて表示する。

CREATE TABLE IF NOT EXISTS customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id   UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  name_kana     TEXT,
  email         TEXT,
  phone         TEXT,
  birthday      DATE,
  gender        TEXT CHECK (gender IN ('male', 'female', 'other')),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_facility ON customers (facility_id, name);
-- 同一施設で同一メールの顧客マスターを二重作成させない（来店ログとの突合キーの一意性を担保）。
-- email 未設定（NULL / 空文字）は対象外＝電話のみ等の顧客は重複制約を受けない。
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_facility_email
  ON customers (facility_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION update_customers_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_customers_updated_at();

-- RLS（施設メンバーのみ自施設の顧客を閲覧・編集。書き込みAPIは service_role で RLS を迂回するが、
-- 最小権限として施設メンバー向けポリシーも明示する）
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_member_read" ON customers FOR SELECT USING (
  EXISTS (SELECT 1 FROM facility_members WHERE facility_id = customers.facility_id AND user_id = auth.uid())
);
CREATE POLICY "customers_member_insert" ON customers FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM facility_members WHERE facility_id = customers.facility_id AND user_id = auth.uid())
);
CREATE POLICY "customers_member_update" ON customers FOR UPDATE USING (
  EXISTS (SELECT 1 FROM facility_members WHERE facility_id = customers.facility_id AND user_id = auth.uid())
);
CREATE POLICY "customers_member_delete" ON customers FOR DELETE USING (
  EXISTS (SELECT 1 FROM facility_members WHERE facility_id = customers.facility_id AND user_id = auth.uid())
);

COMMENT ON TABLE customers IS '顧客マスター（店舗が手入力で追加・編集する顧客台帳）。来店実績は customer_visits を email で突合して表示。';
