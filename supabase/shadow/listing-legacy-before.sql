-- Simulate an existing published row before both the hours and verification
-- gates existed. No production DB and no current-user data is accepted.
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF;
END $$;
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
VALUES('72000000-0000-4000-8000-000000000001','Synthetic','synthetic-listing-booking','その他','検証県','検証市','検証番地','published');
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
VALUES('fa8b0001-0000-4000-8000-000000000003','Synthetic hours legacy','synthetic-publish-hours-legacy','その他','検証県','検証市','検証町1-3','published');
