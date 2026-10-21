-- Drop eight indexes that duplicate another index on the same table column for
-- column (Supabase performance advisor: duplicate_index). Each pair has an
-- identical definition, backs no constraint and is not named by application
-- code. The kept name of each pair is the one recreated by the last-running
-- combined_phase2_to_6.sql where applicable, so a fresh apply converges too.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

DROP INDEX IF EXISTS public.idx_bookings_user_id;            -- keeps idx_bookings_user (user_id)
DROP INDEX IF EXISTS public.idx_user_points_user_id;         -- keeps idx_user_points_user (user_id)
DROP INDEX IF EXISTS public.idx_visits_facility_date;        -- keeps idx_customer_visits_facility_date
DROP INDEX IF EXISTS public.idx_menus_facility;              -- keeps idx_facility_menus_facility
DROP INDEX IF EXISTS public.idx_photos_facility;             -- keeps idx_facility_photos_facility
DROP INDEX IF EXISTS public.idx_fp_status;                   -- keeps idx_facility_profiles_status
DROP INDEX IF EXISTS public.idx_reviews_facility_status;     -- keeps idx_facility_reviews_facility_status
DROP INDEX IF EXISTS public.idx_schedules_staff;             -- keeps idx_staff_schedules_staff
