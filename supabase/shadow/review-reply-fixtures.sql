-- Disposable shadow database only. Synthetic identities; every write rolls back.
-- Owner replies to reviews (20261022140000): only a current owner/admin of the
-- review's facility can publish, edit or delete a reply, and only through the
-- service_role RPCs. Browser roles can read replies but cannot write them,
-- even when their JWT identity belongs to a member of that facility.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '10s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN
    RAISE EXCEPTION 'disposable carelink_shadow required';
  END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fb7a0000-%')
    OR EXISTS(SELECT 1 FROM public.facility_profiles WHERE id::text LIKE 'fb7a0001-%')
    THEN RAISE EXCEPTION 'synthetic namespace collision'; END IF;
END $$;
-- The bootstrap stub returns NULL. Emulate the real JWT identity so a direct
-- write is attempted as the member itself; ROLLBACK restores the stub.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION pg_temp.assert_reply(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'review reply fixture: %', label; END IF; END $$;

-- Owner (01) and admin (02) and staff (03) of A; owner of B only (04).
INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
  ('fb7a0000-0000-4000-8000-000000000001', 'reply-owner@example.invalid', now()),
  ('fb7a0000-0000-4000-8000-000000000002', 'reply-admin@example.invalid', now()),
  ('fb7a0000-0000-4000-8000-000000000003', 'reply-staff@example.invalid', now()),
  ('fb7a0000-0000-4000-8000-000000000004', 'reply-other@example.invalid', now());
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status) VALUES
  ('fb7a0001-0000-4000-8000-000000000001', 'Synthetic reply A', 'synthetic-reply-a', 'その他', '検証県', '検証市', '検証住所', 'draft'),
  ('fb7a0001-0000-4000-8000-000000000002', 'Synthetic reply B', 'synthetic-reply-b', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_members(user_id, facility_id, role) VALUES
  ('fb7a0000-0000-4000-8000-000000000001', 'fb7a0001-0000-4000-8000-000000000001', 'owner'),
  ('fb7a0000-0000-4000-8000-000000000002', 'fb7a0001-0000-4000-8000-000000000001', 'admin'),
  ('fb7a0000-0000-4000-8000-000000000003', 'fb7a0001-0000-4000-8000-000000000001', 'staff'),
  ('fb7a0000-0000-4000-8000-000000000004', 'fb7a0001-0000-4000-8000-000000000002', 'owner');
INSERT INTO public.facility_reviews(id, facility_id, reviewer_name, rating, comment, reviewer_ip) VALUES
  ('fb7a0002-0000-4000-8000-000000000001', 'fb7a0001-0000-4000-8000-000000000001', 'Synthetic reviewer one', 4, 'fixture', '192.0.2.201'),
  ('fb7a0002-0000-4000-8000-000000000002', 'fb7a0001-0000-4000-8000-000000000001', 'Synthetic reviewer two', 5, 'fixture', '192.0.2.202'),
  ('fb7a0002-0000-4000-8000-000000000003', 'fb7a0001-0000-4000-8000-000000000002', 'Synthetic reviewer three', 3, 'fixture', '192.0.2.203');

-- Privilege surface: RPCs are service_role only; browser roles keep read only.
SELECT pg_temp.assert_reply(
  NOT has_function_privilege('anon', 'public.create_review_reply_atomic(uuid,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.create_review_reply_atomic(uuid,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.update_review_reply_atomic(uuid,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.update_review_reply_atomic(uuid,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.delete_review_reply_atomic(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.delete_review_reply_atomic(uuid,uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.create_review_reply_atomic(uuid,uuid,uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.update_review_reply_atomic(uuid,uuid,uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.delete_review_reply_atomic(uuid,uuid,uuid)', 'EXECUTE'),
  'reply RPCs are service_role only');
SELECT pg_temp.assert_reply(
  NOT has_any_column_privilege('anon', 'public.review_replies', 'INSERT')
  AND NOT has_any_column_privilege('authenticated', 'public.review_replies', 'INSERT')
  AND NOT has_any_column_privilege('anon', 'public.review_replies', 'UPDATE')
  AND NOT has_any_column_privilege('authenticated', 'public.review_replies', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.review_replies', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.review_replies', 'DELETE')
  AND has_table_privilege('anon', 'public.review_replies', 'SELECT')
  AND has_table_privilege('authenticated', 'public.review_replies', 'SELECT'),
  'browser roles can read replies and cannot write them');
SELECT pg_temp.assert_reply(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'review_replies') = ARRAY['review_replies_public_read'],
  'only the public read policy remains');

-- A member publishes through the RPC.
SET LOCAL ROLE service_role;
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.create_review_reply_atomic('fb7a0000-0000-4000-8000-000000000001',
    'fb7a0001-0000-4000-8000-000000000001', 'fb7a0002-0000-4000-8000-000000000001', 'Synthetic first reply');
  PERFORM pg_temp.assert_reply(r.review_id = 'fb7a0002-0000-4000-8000-000000000001'
    AND r.content = 'Synthetic first reply' AND r.created_at IS NOT NULL, 'owner publishes');
  PERFORM pg_temp.assert_reply((SELECT user_id = 'fb7a0000-0000-4000-8000-000000000001'
    FROM public.review_replies WHERE id = r.id), 'author is the verified actor');
END $$;
RESET ROLE;

-- Direct browser writes fail for a member of the facility and for a non-member.
DO $$ DECLARE actor uuid; BEGIN
  FOREACH actor IN ARRAY ARRAY['fb7a0000-0000-4000-8000-000000000001', 'fb7a0000-0000-4000-8000-000000000004']::uuid[] LOOP
    PERFORM set_config('request.jwt.claim.sub', actor::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.assert_reply(auth.uid() = actor, 'synthetic JWT identity applied');
    BEGIN
      INSERT INTO public.review_replies(review_id, user_id, content)
        VALUES ('fb7a0002-0000-4000-8000-000000000002', actor, 'Synthetic direct insert');
      RAISE EXCEPTION 'direct INSERT accepted for %', actor;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      UPDATE public.review_replies SET content = 'Synthetic direct edit'
        WHERE review_id = 'fb7a0002-0000-4000-8000-000000000001';
      RAISE EXCEPTION 'direct UPDATE accepted for %', actor;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      DELETE FROM public.review_replies WHERE review_id = 'fb7a0002-0000-4000-8000-000000000001';
      RAISE EXCEPTION 'direct DELETE accepted for %', actor;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      PERFORM public.update_review_reply_atomic(actor, 'fb7a0001-0000-4000-8000-000000000001',
        (SELECT id FROM public.review_replies WHERE review_id = 'fb7a0002-0000-4000-8000-000000000001'), 'Synthetic RPC edit');
      RAISE EXCEPTION 'browser role executed the reply RPC for %', actor;
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE 'permission denied%' THEN RAISE; END IF;
    END;
    PERFORM pg_temp.assert_reply((SELECT count(*) = 1 FROM public.review_replies
      WHERE review_id IN ('fb7a0002-0000-4000-8000-000000000001', 'fb7a0002-0000-4000-8000-000000000002')),
      'browser role still reads published replies');
    RESET ROLE;
  END LOOP;
END $$;
SELECT pg_temp.assert_reply((SELECT content = 'Synthetic first reply' FROM public.review_replies
  WHERE review_id = 'fb7a0002-0000-4000-8000-000000000001'), 'direct writes changed nothing');

SET LOCAL ROLE service_role;
DO $$ DECLARE reply uuid; r record; n int; BEGIN
  SELECT id INTO reply FROM public.review_replies WHERE review_id = 'fb7a0002-0000-4000-8000-000000000001';

  -- A non-member cannot edit, delete or publish on another facility's review,
  -- whether it names that facility or its own.
  BEGIN
    PERFORM public.update_review_reply_atomic('fb7a0000-0000-4000-8000-000000000004',
      'fb7a0001-0000-4000-8000-000000000001', reply, 'Synthetic hostile edit');
    RAISE EXCEPTION 'non-member edit accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'REVIEW_REPLY_FORBIDDEN' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.delete_review_reply_atomic('fb7a0000-0000-4000-8000-000000000004',
      'fb7a0001-0000-4000-8000-000000000001', reply);
    RAISE EXCEPTION 'non-member delete accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'REVIEW_REPLY_FORBIDDEN' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.create_review_reply_atomic('fb7a0000-0000-4000-8000-000000000004',
      'fb7a0001-0000-4000-8000-000000000001', 'fb7a0002-0000-4000-8000-000000000002', 'Synthetic hostile reply');
    RAISE EXCEPTION 'non-member publish accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'REVIEW_REPLY_FORBIDDEN' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO n FROM public.update_review_reply_atomic('fb7a0000-0000-4000-8000-000000000004',
    'fb7a0001-0000-4000-8000-000000000002', reply, 'Synthetic cross-facility edit');
  PERFORM pg_temp.assert_reply(n = 0, 'own facility does not reach another facility reply (edit)');
  SELECT count(*) INTO n FROM public.delete_review_reply_atomic('fb7a0000-0000-4000-8000-000000000004',
    'fb7a0001-0000-4000-8000-000000000002', reply);
  PERFORM pg_temp.assert_reply(n = 0, 'own facility does not reach another facility reply (delete)');
  SELECT count(*) INTO n FROM public.create_review_reply_atomic('fb7a0000-0000-4000-8000-000000000004',
    'fb7a0001-0000-4000-8000-000000000002', 'fb7a0002-0000-4000-8000-000000000002', 'Synthetic cross-facility reply');
  PERFORM pg_temp.assert_reply(n = 0, 'own facility does not reach another facility review (publish)');
  -- Staff of the same facility is not an owner/admin.
  BEGIN
    PERFORM public.update_review_reply_atomic('fb7a0000-0000-4000-8000-000000000003',
      'fb7a0001-0000-4000-8000-000000000001', reply, 'Synthetic staff edit');
    RAISE EXCEPTION 'staff edit accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'REVIEW_REPLY_FORBIDDEN' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.delete_review_reply_atomic('fb7a0000-0000-4000-8000-000000000003',
      'fb7a0001-0000-4000-8000-000000000001', reply);
    RAISE EXCEPTION 'staff delete accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'REVIEW_REPLY_FORBIDDEN' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.update_review_reply_atomic(NULL, 'fb7a0001-0000-4000-8000-000000000001', reply, 'Synthetic anonymous edit');
    RAISE EXCEPTION 'missing actor accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'REVIEW_REPLY_FORBIDDEN' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.assert_reply((SELECT content = 'Synthetic first reply' FROM public.review_replies WHERE id = reply)
    AND NOT EXISTS(SELECT 1 FROM public.review_replies WHERE review_id = 'fb7a0002-0000-4000-8000-000000000002'),
    'rejected attempts changed nothing');

  -- One reply per review; content bounds match the 500-character limit.
  BEGIN
    PERFORM public.create_review_reply_atomic('fb7a0000-0000-4000-8000-000000000002',
      'fb7a0001-0000-4000-8000-000000000001', 'fb7a0002-0000-4000-8000-000000000001', 'Synthetic second reply');
    RAISE EXCEPTION 'second reply accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    PERFORM public.update_review_reply_atomic('fb7a0000-0000-4000-8000-000000000001',
      'fb7a0001-0000-4000-8000-000000000001', reply, '   ');
    RAISE EXCEPTION 'blank edit accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.update_review_reply_atomic('fb7a0000-0000-4000-8000-000000000001',
      'fb7a0001-0000-4000-8000-000000000001', reply, repeat('あ', 501));
    RAISE EXCEPTION 'over-length edit accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.create_review_reply_atomic('fb7a0000-0000-4000-8000-000000000001',
      'fb7a0001-0000-4000-8000-000000000001', 'fb7a0002-0000-4000-8000-000000000002', '');
    RAISE EXCEPTION 'empty reply accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- An admin of the facility edits; only content changes and the old text is returned.
  SELECT * INTO r FROM public.update_review_reply_atomic('fb7a0000-0000-4000-8000-000000000002',
    'fb7a0001-0000-4000-8000-000000000001', reply, repeat('あ', 500));
  PERFORM pg_temp.assert_reply(r.id = reply AND r.previous_content = 'Synthetic first reply'
    AND char_length(r.content) = 500, 'admin edit at the limit');
  PERFORM pg_temp.assert_reply((SELECT user_id = 'fb7a0000-0000-4000-8000-000000000001'
    AND review_id = 'fb7a0002-0000-4000-8000-000000000001' FROM public.review_replies WHERE id = reply),
    'edit keeps the review and original author');
  SELECT * INTO r FROM public.update_review_reply_atomic('fb7a0000-0000-4000-8000-000000000001',
    'fb7a0001-0000-4000-8000-000000000001', reply, 'Synthetic edited reply');
  PERFORM pg_temp.assert_reply(r.content = 'Synthetic edited reply', 'owner edit');
END $$;
RESET ROLE;

-- The public page reads replies directly: the edit is visible at once.
SET LOCAL ROLE anon;
SELECT pg_temp.assert_reply((SELECT array_agg(content) FROM public.review_replies
  WHERE review_id = 'fb7a0002-0000-4000-8000-000000000001') = ARRAY['Synthetic edited reply'],
  'public read shows the edited reply');
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$ DECLARE reply uuid; r record; n int; BEGIN
  SELECT id INTO reply FROM public.review_replies WHERE review_id = 'fb7a0002-0000-4000-8000-000000000001';
  SELECT * INTO r FROM public.delete_review_reply_atomic('fb7a0000-0000-4000-8000-000000000001',
    'fb7a0001-0000-4000-8000-000000000001', reply);
  PERFORM pg_temp.assert_reply(r.id = reply AND r.content = 'Synthetic edited reply', 'owner delete returns the removed text');
  SELECT count(*) INTO n FROM public.delete_review_reply_atomic('fb7a0000-0000-4000-8000-000000000001',
    'fb7a0001-0000-4000-8000-000000000001', reply);
  PERFORM pg_temp.assert_reply(n = 0, 'second delete finds nothing');
  SELECT count(*) INTO n FROM public.update_review_reply_atomic('fb7a0000-0000-4000-8000-000000000001',
    'fb7a0001-0000-4000-8000-000000000001', reply, 'Synthetic edit after delete');
  PERFORM pg_temp.assert_reply(n = 0, 'edit after delete finds nothing');
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_temp.assert_reply(NOT EXISTS(SELECT 1 FROM public.review_replies
  WHERE review_id = 'fb7a0002-0000-4000-8000-000000000001'), 'public read shows nothing after delete');
RESET ROLE;

-- After a delete the review can be answered again; a revoked admin cannot write.
SET LOCAL ROLE service_role;
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.create_review_reply_atomic('fb7a0000-0000-4000-8000-000000000002',
    'fb7a0001-0000-4000-8000-000000000001', 'fb7a0002-0000-4000-8000-000000000001', 'Synthetic new reply');
  PERFORM pg_temp.assert_reply(r.content = 'Synthetic new reply', 'reply again after delete');
END $$;
RESET ROLE;
DELETE FROM public.facility_members
  WHERE user_id = 'fb7a0000-0000-4000-8000-000000000002' AND facility_id = 'fb7a0001-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
DO $$ DECLARE reply uuid; BEGIN
  SELECT id INTO reply FROM public.review_replies WHERE review_id = 'fb7a0002-0000-4000-8000-000000000001';
  BEGIN
    PERFORM public.update_review_reply_atomic('fb7a0000-0000-4000-8000-000000000002',
      'fb7a0001-0000-4000-8000-000000000001', reply, 'Synthetic revoked edit');
    RAISE EXCEPTION 'revoked admin edit accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'REVIEW_REPLY_FORBIDDEN' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.delete_review_reply_atomic('fb7a0000-0000-4000-8000-000000000002',
      'fb7a0001-0000-4000-8000-000000000001', reply);
    RAISE EXCEPTION 'revoked admin delete accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'REVIEW_REPLY_FORBIDDEN' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.assert_reply((SELECT content = 'Synthetic new reply' FROM public.review_replies WHERE id = reply),
    'revoked admin changed nothing');
END $$;
RESET ROLE;
ROLLBACK;
