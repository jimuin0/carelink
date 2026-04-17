-- キャンセル待ち機能（v8.34）
-- 予約が満席の時間帯にウェイトリスト登録し、
-- キャンセルが出たら自動でメール+LINE通知する

CREATE TABLE IF NOT EXISTS booking_waitlist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id     UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  menu_id         UUID REFERENCES facility_menus(id) ON DELETE SET NULL,
  staff_id        UUID,
  date            DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  customer_name   TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  line_user_id    TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'notified', 'booked', 'expired', 'cancelled')),
  notified_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_facility_date ON booking_waitlist (facility_id, date, start_time);
CREATE INDEX IF NOT EXISTS idx_waitlist_user ON booking_waitlist (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON booking_waitlist (status) WHERE status = 'waiting';

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION update_waitlist_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_waitlist_updated_at
  BEFORE UPDATE ON booking_waitlist
  FOR EACH ROW EXECUTE FUNCTION update_waitlist_updated_at();

-- RLS
ALTER TABLE booking_waitlist ENABLE ROW LEVEL SECURITY;

-- 自分のウェイトリストのみ閲覧
CREATE POLICY "waitlist_user_read" ON booking_waitlist FOR SELECT USING (
  user_id = auth.uid()
);

-- 誰でも登録可能（guest checkout 対応のため）
CREATE POLICY "waitlist_insert" ON booking_waitlist FOR INSERT WITH CHECK (true);

-- 自分のウェイトリストのみ更新・削除
CREATE POLICY "waitlist_user_modify" ON booking_waitlist FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "waitlist_user_delete" ON booking_waitlist FOR DELETE USING (user_id = auth.uid());

-- 施設メンバーは自施設のウェイトリストを閲覧
CREATE POLICY "waitlist_facility_member_read" ON booking_waitlist FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM facility_members
    WHERE facility_id = booking_waitlist.facility_id AND user_id = auth.uid()
  )
);

COMMENT ON TABLE booking_waitlist IS 'キャンセル待ち登録。キャンセル発生時に notified → 48時間以内未予約で expired に遷移。';
