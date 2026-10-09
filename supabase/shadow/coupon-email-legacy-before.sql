-- Old-schema, synthetic R15 upgrade probe. Never a production backfill.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'carelink_shadow' OR current_setting('server_version_num')::int/10000<>17
   OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_coupon_codes' AND column_name='notified_at')
   OR to_regclass('public.customer_coupon_email_operations') IS NOT NULL THEN RAISE EXCEPTION 'old shadow coupon schema required'; END IF;
END $$;
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
 VALUES('ec090000-0000-4000-8000-000000000001','Synthetic legacy coupon upgrade','synthetic-coupon-upgrade','その他','検証県','検証市','検証住所','published');
INSERT INTO public.user_coupon_codes(id,facility_id,email,code,discount_type,discount_value,reason,valid_until,notified_at)
 VALUES('ec090000-0000-4000-8000-000000000002','ec090000-0000-4000-8000-000000000001','coupon-upgrade-null@example.invalid','SYNTHETIC_COUPON_UPGRADE_NULL','fixed',500,'at_risk',current_date+30,NULL),
 ('ec090000-0000-4000-8000-000000000003','ec090000-0000-4000-8000-000000000001','coupon-upgrade-accepted@example.invalid','SYNTHETIC_COUPON_UPGRADE_ACCEPTED','fixed',500,'at_risk',current_date+30,'2026-10-01T01:02:03Z');
COMMIT;
