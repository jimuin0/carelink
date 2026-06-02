-- グループ予約テーブル
-- 複数人同時予約（家族・友人グループ対応）

CREATE TABLE IF NOT EXISTS group_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  organizer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  booking_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  menu_id UUID REFERENCES facility_menus(id) ON DELETE SET NULL,
  -- FK 先は canonical な staff_profiles（`facility_staff` は本番にも migration にも存在せず、
  --   このまま適用すると 42P01 で失敗する dangling FK だった。他テーブルの staff_id は全て
  --   staff_profiles(id) を参照しており、それに統一する root fix）。
  staff_id UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  total_members INT NOT NULL DEFAULT 2 CHECK (total_members BETWEEN 2 AND 10),
  confirmed_members INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  notes TEXT,
  share_code TEXT UNIQUE DEFAULT upper(substring(gen_random_uuid()::text FROM 1 FOR 8)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- グループメンバーテーブル
CREATE TABLE IF NOT EXISTS group_booking_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_booking_id UUID NOT NULL REFERENCES group_bookings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_name TEXT,
  guest_email TEXT,
  guest_phone TEXT,
  status TEXT NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'confirmed', 'declined', 'pending')),
  is_organizer BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_group_bookings_facility ON group_bookings(facility_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_group_bookings_organizer ON group_bookings(organizer_id);
CREATE INDEX IF NOT EXISTS idx_group_bookings_share_code ON group_bookings(share_code);
CREATE INDEX IF NOT EXISTS idx_group_booking_members_group ON group_booking_members(group_booking_id);
CREATE INDEX IF NOT EXISTS idx_group_booking_members_user ON group_booking_members(user_id);

-- RLS
ALTER TABLE group_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_booking_members ENABLE ROW LEVEL SECURITY;

-- オーガナイザーは自分のグループを読み書き
CREATE POLICY "group_bookings_organizer" ON group_bookings
  FOR ALL USING (organizer_id = auth.uid());

-- メンバーはshare_codeで参加時に読み取り可能（APIで制御）
CREATE POLICY "group_bookings_member_read" ON group_bookings
  FOR SELECT USING (
    organizer_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM group_booking_members
      WHERE group_booking_id = group_bookings.id AND user_id = auth.uid()
    )
  );

CREATE POLICY "group_members_read" ON group_booking_members
  FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM group_bookings gb
      WHERE gb.id = group_booking_id AND gb.organizer_id = auth.uid()
    )
  );

CREATE POLICY "group_members_own_update" ON group_booking_members
  FOR UPDATE USING (user_id = auth.uid());

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION update_group_bookings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_group_bookings_updated_at ON group_bookings;
CREATE TRIGGER trg_group_bookings_updated_at
  BEFORE UPDATE ON group_bookings
  FOR EACH ROW EXECUTE FUNCTION update_group_bookings_updated_at();
