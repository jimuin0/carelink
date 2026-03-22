-- Phase 5: サロン管理ダッシュボード

-- 施設メンバー（権限管理）
CREATE TABLE IF NOT EXISTS facility_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'admin', 'staff')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, facility_id)
);

-- 顧客来店履歴
CREATE TABLE IF NOT EXISTS customer_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  customer_email TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  visit_date DATE NOT NULL,
  menu_name TEXT,
  staff_name TEXT,
  amount INT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE facility_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_visits ENABLE ROW LEVEL SECURITY;

-- facility_members: 本人の所属のみ閲覧
CREATE POLICY "facility_members_own_read" ON facility_members FOR SELECT USING (auth.uid() = user_id);

-- customer_visits: 施設メンバーのみ閲覧
CREATE POLICY "customer_visits_member_read" ON customer_visits FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM facility_members fm
    WHERE fm.facility_id = customer_visits.facility_id
    AND fm.user_id = auth.uid()
  )
);

-- customer_visits: 施設メンバーのみ挿入
CREATE POLICY "customer_visits_member_insert" ON customer_visits FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM facility_members fm
    WHERE fm.facility_id = customer_visits.facility_id
    AND fm.user_id = auth.uid()
  )
);

-- bookings: 施設メンバーが管理する予約を閲覧可能に
CREATE POLICY "bookings_facility_member_read" ON bookings FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM facility_members fm
    WHERE fm.facility_id = bookings.facility_id
    AND fm.user_id = auth.uid()
  )
);

-- bookings: 施設メンバーがステータス変更可能
CREATE POLICY "bookings_facility_member_update" ON bookings FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM facility_members fm
    WHERE fm.facility_id = bookings.facility_id
    AND fm.user_id = auth.uid()
  )
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_facility_members_user ON facility_members(user_id);
CREATE INDEX IF NOT EXISTS idx_facility_members_facility ON facility_members(facility_id);
CREATE INDEX IF NOT EXISTS idx_customer_visits_facility ON customer_visits(facility_id);
CREATE INDEX IF NOT EXISTS idx_customer_visits_email ON customer_visits(customer_email);
