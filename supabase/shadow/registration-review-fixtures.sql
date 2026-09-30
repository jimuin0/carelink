-- Synthetic, transaction-scoped fixtures. No existing application row is touched.
BEGIN;
INSERT INTO public.salons(id,facility_name,business_type,representative_name,contact_name,email,phone,status)
VALUES ('89000000-0000-4000-8000-000000000001','Synthetic revision fixture','ヘアサロン',
 'Synthetic','Synthetic','revision@example.invalid','09000000000','pending');
DO $$ DECLARE affected integer; actual integer; BEGIN
  UPDATE public.salons SET status='approved' WHERE id='89000000-0000-4000-8000-000000000001'
    AND status='pending' AND review_revision=0;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'initial decision failed'; END IF;
  SELECT review_revision INTO actual FROM public.salons WHERE id='89000000-0000-4000-8000-000000000001';
  IF actual<>1 THEN RAISE EXCEPTION 'revision did not advance'; END IF;
  UPDATE public.salons SET status='pending',review_revision=0 WHERE id='89000000-0000-4000-8000-000000000001'
    AND status='approved' AND review_revision=1;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'explicit reopen failed'; END IF;
  SELECT review_revision INTO actual FROM public.salons WHERE id='89000000-0000-4000-8000-000000000001';
  IF actual<>2 THEN RAISE EXCEPTION 'caller revision reset was trusted'; END IF;
  UPDATE public.salons SET status='rejected' WHERE id='89000000-0000-4000-8000-000000000001'
    AND status='pending' AND review_revision=0;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'ABA stale decision accepted'; END IF;
  UPDATE public.salons SET status=status WHERE id='89000000-0000-4000-8000-000000000001';
  SELECT review_revision INTO actual FROM public.salons WHERE id='89000000-0000-4000-8000-000000000001';
  IF actual<>3 THEN RAISE EXCEPTION 'same-value update did not advance'; END IF;
  IF has_function_privilege('anon','public.bump_salon_review_revision()','EXECUTE')
    OR has_function_privilege('authenticated','public.bump_salon_review_revision()','EXECUTE') THEN
    RAISE EXCEPTION 'public execution grant exists';
  END IF;
END $$;
INSERT INTO public.salons(id,facility_name,business_type,representative_name,contact_name,email,phone,status,review_revision)
VALUES ('89000000-0000-4000-8000-000000000002','Synthetic overflow fixture','ヘアサロン',
 'Synthetic','Synthetic','revision-overflow@example.invalid','09000000000','pending',2147483647);
DO $$ BEGIN
  BEGIN
    UPDATE public.salons SET status='approved' WHERE id='89000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'revision overflow did not fail closed';
  EXCEPTION WHEN numeric_value_out_of_range THEN NULL;
  END;
  IF (SELECT status FROM public.salons WHERE id='89000000-0000-4000-8000-000000000002')<>'pending' THEN
    RAISE EXCEPTION 'overflow changed business state';
  END IF;
END $$;
ROLLBACK;
