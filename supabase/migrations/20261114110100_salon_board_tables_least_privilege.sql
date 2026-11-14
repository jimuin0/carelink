-- 掲載ボード由来の 3 表の権限を絞る（2026年11月14日・点検 A281）。
--
-- 対象の定義元: supabase/migrations/20260813000001_codify_prod_only_salon_board_tables.sql
--   facility_booking_suspensions / facility_daily_capacity は SELECT ポリシーが USING (true) のため、
--   全列（管理者の auth.users.id である created_by を含む）を誰でも読めた。さらに Supabase の既定権限で
--   anon / authenticated に INSERT・UPDATE・DELETE・TRUNCATE まで GRANT されていた
--   （書き込みポリシーが無いので INSERT 等は RLS で止まるが、TRUNCATE は RLS を素通りする）。
--   salon_customer_notes はポリシー 0 本（service_role 専用）だが、同じく TRUNCATE が残っていた。
--
-- main のアプリはこの 3 表を参照していない（読み書きとも 0 箇所）。公開読みの意図は残し、
-- created_by を除く列だけを読めるようにする。書き込みは service_role のみ。
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION
      'このデータベースは CareLink ではありません（public.facility_profiles が存在しない）。'
      ' 接続先プロジェクトを確認してください。CareLink の本番 ref は xzafxiupbflvgbarrihe です。';
  END IF;
END
$guard$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.facility_booking_suspensions, public.facility_daily_capacity, public.salon_customer_notes
  FROM PUBLIC, anon, authenticated;

-- 列単位で読める範囲を絞る（RLS は列を絞れないため）。
REVOKE SELECT ON public.facility_booking_suspensions, public.facility_daily_capacity, public.salon_customer_notes
  FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, facility_id, suspend_date, start_time, end_time, created_at)
  ON public.facility_booking_suspensions TO anon, authenticated;
GRANT SELECT (id, facility_id, capacity_date, max_bookings, updated_at)
  ON public.facility_daily_capacity TO anon, authenticated;
