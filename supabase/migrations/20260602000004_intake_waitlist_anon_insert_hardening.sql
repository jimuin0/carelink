-- ============================================================
-- CareLink: intake_form_responses / booking_waitlist anon INSERT 絞り込み (2026-06-02)
-- ============================================================
-- 背景（事実・コード確認済み）:
--   - src/app/api/intake/route.ts   は anon キー（NEXT_PUBLIC_SUPABASE_ANON_KEY）で
--     intake_form_responses に INSERT し、user_id を `user?.id ?? null` で渡す
--     （未ログインの guest 送信を許容する仕様）。
--   - src/app/api/waitlist/route.ts も anon キーで booking_waitlist に INSERT し、
--     user_id を `user?.id ?? null` で渡す（guest checkout 対応）。
--
-- 問題（予防的に塞ぐ）:
--   両テーブルの INSERT ポリシーが `WITH CHECK (true)` のため、公開されている
--   anon キーを直接使えば、誰でも **任意の user_id を詐称した行**を無制限に注入できる。
--   intake は医療系 PII（responses JSONB / customer_name）、waitlist は
--   email / phone / line_user_id / customer_name を保持しており、
--   なりすまし登録・スパム注入の攻撃面になる。
--
-- 対策（恒久・guest 送信は維持）:
--   `WITH CHECK (true)` → `WITH CHECK (user_id IS NULL OR user_id = auth.uid())`。
--   - 未ログイン送信（user_id = NULL）は引き続き許可。
--   - ログインユーザーは自分の user_id 以外を詐称できない。
--   既存の facility_reviews / facility_inquiries 是正（20260420 系）と同方針。
--
-- 冪等: DROP POLICY IF EXISTS → CREATE POLICY。再実行で先の DROP が効くため安全。
-- ============================================================

-- ---- intake_form_responses ----
ALTER TABLE intake_form_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "intake_response_insert" ON intake_form_responses;

CREATE POLICY "intake_response_insert" ON intake_form_responses
  FOR INSERT
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- ---- booking_waitlist ----
ALTER TABLE booking_waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "waitlist_insert" ON booking_waitlist;

CREATE POLICY "waitlist_insert" ON booking_waitlist
  FOR INSERT
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());
