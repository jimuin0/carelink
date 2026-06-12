-- リマインダー多段化＋有料オプション（アップセル）基盤
-- 1) option_catalog: 有料オプションのカタログ（価格は DB で変更可能・仮価格）
-- 2) facility_entitlements: 施設ごとの購入済みオプション（Stripe サブスクで自動 ON/OFF）
-- 3) facility_reminder_settings: 施設ごとのリマインダー送信設定（7日前メール=無料）
-- 4) sent_reminders に kind を追加（email_1d/email_3d/email_7d/line_3d/line_7d を冪等に区別）

BEGIN;

-- 1) オプションカタログ
CREATE TABLE IF NOT EXISTS option_catalog (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  -- 月額（円・税抜想定）。仮価格: SB から変更せず DB 更新で改定できるようカタログ化。
  monthly_price INT NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
  -- true: 自動課金でなく「申込み（要相談）」導線のみ（例: HPB 連携は個別対応）
  contact_only BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE option_catalog ENABLE ROW LEVEL SECURITY;
-- SB（施設管理者）が価格・説明を表示するため読み取りのみ許可。書き込みは service role のみ。
CREATE POLICY "authenticated_read_catalog" ON option_catalog
  FOR SELECT TO authenticated USING (true);

INSERT INTO option_catalog (key, name, description, monthly_price, contact_only, sort_order) VALUES
  ('reminder_email_3d', '3日前メールリマインド', '予約3日前のリマインドメールを自動送信します（7日前メールは無料）。', 500, false, 10),
  ('reminder_line', 'LINEリマインド（3日前・7日前）', '予約3日前・7日前のリマインドをLINEで自動送信します。', 1500, false, 20),
  ('time_adjust_line', '時間調整依頼のLINE送信', '予約時間の調整依頼をLINEで送信できます（メール送信は無料）。', 500, false, 30),
  ('hpb_integration', 'ホットペッパービューティー連携', 'HPB（サロンボード）との予約連携。個別対応のため申込み後にご相談となります。', 3000, true, 40)
ON CONFLICT (key) DO NOTHING;

-- 2) 施設エンタイトルメント（購入済みオプション）
CREATE TABLE IF NOT EXISTS facility_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  option_key TEXT NOT NULL REFERENCES option_catalog(key),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled')),
  stripe_subscription_id TEXT,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT facility_entitlements_facility_option_uniq UNIQUE (facility_id, option_key)
);

ALTER TABLE facility_entitlements ENABLE ROW LEVEL SECURITY;
-- 施設メンバーは自施設の購読状態を閲覧可能（購入・解約は service role 経由の API のみ）
CREATE POLICY "members_read_entitlements" ON facility_entitlements
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM facility_members fm
      WHERE fm.facility_id = facility_entitlements.facility_id
        AND fm.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_facility_entitlements_facility ON facility_entitlements(facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_entitlements_stripe_sub ON facility_entitlements(stripe_subscription_id);

-- 3) リマインダー設定（施設単位）。既定は全 OFF（突然の一斉送信を避け、SB で明示的に ON にする）。
--    前日メールは従来挙動（全施設・無条件送信）を維持するため設定化しない。
CREATE TABLE IF NOT EXISTS facility_reminder_settings (
  facility_id UUID PRIMARY KEY REFERENCES facility_profiles(id) ON DELETE CASCADE,
  remind_7d_email BOOLEAN NOT NULL DEFAULT false, -- 無料
  remind_3d_email BOOLEAN NOT NULL DEFAULT false, -- 有料: reminder_email_3d
  remind_7d_line  BOOLEAN NOT NULL DEFAULT false, -- 有料: reminder_line
  remind_3d_line  BOOLEAN NOT NULL DEFAULT false, -- 有料: reminder_line
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE facility_reminder_settings ENABLE ROW LEVEL SECURITY;
-- owner/admin のみ読み書き（facility_line_settings と同方針）
CREATE POLICY "members_manage_reminder_settings" ON facility_reminder_settings
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM facility_members fm
      WHERE fm.facility_id = facility_reminder_settings.facility_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM facility_members fm
      WHERE fm.facility_id = facility_reminder_settings.facility_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner', 'admin')
    )
  );

-- 4) sent_reminders に kind を追加（既存行は前日メール=email_1d として扱う）
ALTER TABLE sent_reminders ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'email_1d';
ALTER TABLE sent_reminders DROP CONSTRAINT IF EXISTS sent_reminders_booking_date_uniq;
ALTER TABLE sent_reminders DROP CONSTRAINT IF EXISTS sent_reminders_booking_date_kind_uniq;
ALTER TABLE sent_reminders
  ADD CONSTRAINT sent_reminders_booking_date_kind_uniq UNIQUE (booking_id, reminder_date, kind);

COMMIT;
