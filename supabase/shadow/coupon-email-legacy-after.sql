-- Actual old rows survived a column rename; old consumer paths are blocked.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF current_database()<>'carelink_shadow' THEN RAISE EXCEPTION 'disposable shadow required'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_coupon_upgrade(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'coupon upgrade fixture: %',label; END IF; END $$;
SELECT pg_temp.assert_coupon_upgrade((SELECT count(*)=2 FROM public.user_coupon_codes WHERE facility_id='ec090000-0000-4000-8000-000000000001'),'old rows retained without extra coupons');
SELECT pg_temp.assert_coupon_upgrade((SELECT provider_accepted_at IS NULL FROM public.user_coupon_codes WHERE id='ec090000-0000-4000-8000-000000000002'),'legacy uncertainty preserved');
SELECT pg_temp.assert_coupon_upgrade((SELECT provider_accepted_at='2026-10-01T01:02:03Z'::timestamptz FROM public.user_coupon_codes WHERE id='ec090000-0000-4000-8000-000000000003'),'real historical acceptance timestamp preserved');
SET LOCAL ROLE service_role;
DO $$ DECLARE r record; a record; skipped text[]:=ARRAY[]::text[]; row record; BEGIN
 SELECT * INTO r FROM public.reserve_customer_coupon_email_atomic('ec090000-0000-4000-8000-000000000001','coupon-upgrade-null@example.invalid',current_date+30);
 PERFORM pg_temp.assert_coupon_upgrade(r.state='legacy_uncertain' AND r.operation_id IS NULL,'new consumer does not resend old null');
 SELECT * INTO r FROM public.reserve_customer_coupon_email_atomic('ec090000-0000-4000-8000-000000000001','coupon-upgrade-accepted@example.invalid',current_date+30);
 PERFORM pg_temp.assert_coupon_upgrade(r.state='already_notified' AND r.operation_id IS NULL,'new consumer keeps old acceptance');
 SELECT * INTO a FROM public.reserve_customer_coupon_email_atomic('ec090000-0000-4000-8000-000000000001','coupon-upgrade-new@example.invalid',current_date+30);
 PERFORM pg_temp.assert_coupon_upgrade(a.state='reserved' AND a.operation_id IS NOT NULL,'new coupon and operation reserved together');
 -- Reproduce the a46 SELECT, missing-column branch and legacy all-existing dedup.
 BEGIN
  PERFORM email,code,notified_at FROM public.user_coupon_codes WHERE facility_id='ec090000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'old notified column still readable';
 EXCEPTION WHEN undefined_column THEN
  FOR row IN SELECT email,code FROM public.user_coupon_codes WHERE facility_id='ec090000-0000-4000-8000-000000000001' AND reason='at_risk' LOOP skipped:=array_append(skipped,row.email); END LOOP;
 END;
 PERFORM pg_temp.assert_coupon_upgrade('coupon-upgrade-new@example.invalid'=ANY(skipped) AND cardinality(skipped)=3,'old consumer skips pending NEW operation and both legacy rows');
 -- A deferred constraint is evaluated before an INSERT transaction can report
 -- success. Force that exact boundary and prove the old direct path rolls back.
 BEGIN
  INSERT INTO public.user_coupon_codes(facility_id,email,code,discount_type,discount_value,reason,valid_until)
   VALUES('ec090000-0000-4000-8000-000000000001','coupon-upgrade-direct@example.invalid','SYNTHETIC_COUPON_DIRECT_BLOCKED','fixed',500,'at_risk',current_date+30);
  SET CONSTRAINTS require_at_risk_coupon_email_operation IMMEDIATE;
  RAISE EXCEPTION 'old direct coupon unexpectedly committed';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'COUPON_EMAIL_OPERATION_REQUIRED' THEN RAISE; END IF; END;
 SET CONSTRAINTS require_at_risk_coupon_email_operation DEFERRED;
 PERFORM pg_temp.assert_coupon_upgrade(NOT EXISTS(SELECT 1 FROM public.user_coupon_codes WHERE email='coupon-upgrade-direct@example.invalid'),'failed old insert has no coupon');
 SET CONSTRAINTS require_at_risk_coupon_email_operation IMMEDIATE;
 PERFORM pg_temp.assert_coupon_upgrade((SELECT count(*)=1 FROM public.customer_coupon_email_operations WHERE coupon_id=a.coupon_id),'new reserve satisfies commit constraint');
END $$;
RESET ROLE;
ROLLBACK;
