-- Stripe決済+キャンセルポリシー（v8.5 Phase 2）

-- 予約に決済情報追加
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'refunded', 'partial_refund'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_amount INT DEFAULT 0;

-- キャンセルポリシー（店舗別）
CREATE TABLE IF NOT EXISTS facility_cancel_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL UNIQUE REFERENCES facility_profiles(id) ON DELETE CASCADE,
  free_cancel_hours INT DEFAULT 24,
  late_cancel_rate INT DEFAULT 50,
  no_show_rate INT DEFAULT 100,
  policy_text TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE facility_cancel_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON facility_cancel_policies FOR SELECT USING (true);
CREATE POLICY "Facility members can manage" ON facility_cancel_policies
  FOR ALL USING (EXISTS (
    SELECT 1 FROM facility_members
    WHERE facility_members.facility_id = facility_cancel_policies.facility_id
      AND facility_members.user_id = auth.uid()
      AND facility_members.role IN ('owner', 'admin')
  ));
