-- テレヘルス/オンライン相談
CREATE TABLE IF NOT EXISTS telehealth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  room_id TEXT, -- ビデオ通話ルームID
  meeting_url TEXT, -- Zoom/Google Meet URL
  platform TEXT DEFAULT 'external', -- 'external' (Zoom/Meet) | 'builtin'
  patient_notes TEXT, -- 事前問診
  session_notes TEXT, -- セッション後メモ（スタッフ記録）
  fee INTEGER DEFAULT 0, -- 料金（円）
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE telehealth_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "telehealth_own" ON telehealth_sessions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "telehealth_admin" ON telehealth_sessions
  FOR ALL USING (
    facility_id IN (
      SELECT facility_id FROM facility_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'staff')
    )
  );

CREATE INDEX IF NOT EXISTS idx_telehealth_facility ON telehealth_sessions(facility_id);
CREATE INDEX IF NOT EXISTS idx_telehealth_user ON telehealth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_telehealth_scheduled ON telehealth_sessions(scheduled_at);
