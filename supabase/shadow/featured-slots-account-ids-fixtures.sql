-- Disposable shadow database only. Synthetic identities; every write rolls back.
-- Asserts the state after 20261023110000..20261023110200:
--   * featured_slots (paid sponsor slots): browser roles can only read. An owner, an admin of
--     another shop and a platform admin cannot create, activate, extend or delete a slot
--     directly; only service_role writes (/api/admin/featured-ads creates an unpaid row,
--     the Stripe webhook activates it). New rows default to inactive. Anonymous visitors
--     still read active, in-window rows for the search sponsor block.
--   * facility_qa: anon and authenticated read only the columns the pages show. The asker
--     (user_id) and the answering staff member (answered_by) are service_role only, so
--     select * fails for browser roles.
--   * review_helpful: anon reads nothing; a signed-in user reads, adds and removes only
--     their own votes. Counts come from get_review_helpful_counts (review id and count only,
--     public reviews only).
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '10s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN
    RAISE EXCEPTION 'disposable carelink_shadow required';
  END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fb9c0000-%')
    OR EXISTS(SELECT 1 FROM public.facility_profiles WHERE id::text LIKE 'fb9c0001-%')
    THEN RAISE EXCEPTION 'synthetic namespace collision'; END IF;
END $$;
-- The bootstrap stub returns NULL. Emulate the real JWT identity so a direct
-- write is attempted as the member itself; ROLLBACK restores the stub.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION pg_temp.assert_ids(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'featured/account-id fixture: %', label; END IF; END $$;

-- 01 owner of A, 02 owner of B, 03 platform admin, 04 asker, 05 and 06 voters, 07 stranger.
INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
  ('fb9c0000-0000-4000-8000-000000000001', 'featured-owner-a@example.invalid', now()),
  ('fb9c0000-0000-4000-8000-000000000002', 'featured-owner-b@example.invalid', now()),
  ('fb9c0000-0000-4000-8000-000000000003', 'featured-platform@example.invalid', now()),
  ('fb9c0000-0000-4000-8000-000000000004', 'featured-asker@example.invalid', now()),
  ('fb9c0000-0000-4000-8000-000000000005', 'featured-voter-one@example.invalid', now()),
  ('fb9c0000-0000-4000-8000-000000000006', 'featured-voter-two@example.invalid', now()),
  ('fb9c0000-0000-4000-8000-000000000007', 'featured-stranger@example.invalid', now());
UPDATE public.profiles SET is_platform_admin = true WHERE id = 'fb9c0000-0000-4000-8000-000000000003';
-- A and B are published (anyone can publish their own shop after onboarding); C is a draft.
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status) VALUES
  ('fb9c0001-0000-4000-8000-000000000001', 'Synthetic featured A', 'synthetic-featured-a', 'その他', '検証県', '検証市', '検証住所', 'published'),
  ('fb9c0001-0000-4000-8000-000000000002', 'Synthetic featured B', 'synthetic-featured-b', 'その他', '検証県', '検証市', '検証住所', 'published'),
  ('fb9c0001-0000-4000-8000-000000000003', 'Synthetic featured C', 'synthetic-featured-c', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_members(user_id, facility_id, role) VALUES
  ('fb9c0000-0000-4000-8000-000000000001', 'fb9c0001-0000-4000-8000-000000000001', 'owner'),
  ('fb9c0000-0000-4000-8000-000000000002', 'fb9c0001-0000-4000-8000-000000000002', 'owner');

-- ---------------------------------------------------------------------------
-- featured_slots
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_ids(
  has_table_privilege('anon', 'public.featured_slots', 'SELECT')
  AND has_table_privilege('authenticated', 'public.featured_slots', 'SELECT')
  AND NOT has_any_column_privilege('anon', 'public.featured_slots', 'INSERT')
  AND NOT has_any_column_privilege('authenticated', 'public.featured_slots', 'INSERT')
  AND NOT has_any_column_privilege('anon', 'public.featured_slots', 'UPDATE')
  AND NOT has_any_column_privilege('authenticated', 'public.featured_slots', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.featured_slots', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.featured_slots', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.featured_slots', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.featured_slots', 'TRUNCATE')
  AND has_table_privilege('service_role', 'public.featured_slots', 'SELECT')
  AND has_table_privilege('service_role', 'public.featured_slots', 'INSERT')
  AND has_table_privilege('service_role', 'public.featured_slots', 'UPDATE')
  AND has_table_privilege('service_role', 'public.featured_slots', 'DELETE'),
  'featured slots: browser roles read only, service_role writes');
SELECT pg_temp.assert_ids(
  (SELECT array_agg(policyname::text || ':' || cmd ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'featured_slots')
    = ARRAY['featured_slots_owner_read:SELECT', 'featured_slots_platform_admin_read:SELECT',
            'featured_slots_public_read:SELECT']
  AND (SELECT bool_and(roles = ARRAY['authenticated']::name[]) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'featured_slots' AND policyname <> 'featured_slots_public_read'),
  'featured slots: only read policies remain; member and admin reads are for signed-in users');

-- The API creates an unpaid slot for A (is_active=false); B's slot omits is_active.
SET LOCAL ROLE service_role;
INSERT INTO public.featured_slots(id, facility_id, slot_type, starts_at, ends_at, budget_yen, is_active) VALUES
  ('fb9c0002-0000-4000-8000-000000000001', 'fb9c0001-0000-4000-8000-000000000001', 'search_top',
   now() - interval '1 day', now() + interval '30 days', 9800, false);
INSERT INTO public.featured_slots(id, facility_id, slot_type, starts_at, ends_at, budget_yen) VALUES
  ('fb9c0002-0000-4000-8000-000000000002', 'fb9c0001-0000-4000-8000-000000000002', 'search_top',
   now() - interval '1 day', now() + interval '30 days', 9800);
RESET ROLE;
SELECT pg_temp.assert_ids(
  (SELECT NOT is_active FROM public.featured_slots WHERE id = 'fb9c0002-0000-4000-8000-000000000002'),
  'a slot is inactive unless is_active is set');
-- The Stripe webhook activates B's paid slot.
SET LOCAL ROLE service_role;
UPDATE public.featured_slots SET is_active = true WHERE id = 'fb9c0002-0000-4000-8000-000000000002';
RESET ROLE;

-- Neither the owner of A, the owner of B nor a platform admin can write a slot directly.
DO $$ DECLARE actor uuid; BEGIN
  FOREACH actor IN ARRAY ARRAY['fb9c0000-0000-4000-8000-000000000001', 'fb9c0000-0000-4000-8000-000000000002',
    'fb9c0000-0000-4000-8000-000000000003']::uuid[] LOOP
    PERFORM set_config('request.jwt.claim.sub', actor::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.assert_ids(auth.uid() = actor, 'synthetic JWT identity applied');
    BEGIN
      INSERT INTO public.featured_slots(facility_id, slot_type, starts_at, ends_at)
        VALUES ('fb9c0001-0000-4000-8000-000000000001', 'search_top', now(), '2099-01-01T00:00:00Z');
      RAISE EXCEPTION 'direct sponsor INSERT accepted for %', actor;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      UPDATE public.featured_slots SET is_active = true WHERE id = 'fb9c0002-0000-4000-8000-000000000001';
      RAISE EXCEPTION 'direct sponsor activation accepted for %', actor;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      UPDATE public.featured_slots SET ends_at = '2099-01-01T00:00:00Z' WHERE id = 'fb9c0002-0000-4000-8000-000000000002';
      RAISE EXCEPTION 'direct sponsor extension accepted for %', actor;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      DELETE FROM public.featured_slots WHERE id = 'fb9c0002-0000-4000-8000-000000000002';
      RAISE EXCEPTION 'direct sponsor DELETE accepted for %', actor;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;
  END LOOP;
END $$;
SELECT pg_temp.assert_ids(
  (SELECT count(*) = 2 FROM public.featured_slots WHERE facility_id::text LIKE 'fb9c0001-%')
  AND (SELECT NOT is_active FROM public.featured_slots WHERE id = 'fb9c0002-0000-4000-8000-000000000001')
  AND (SELECT is_active AND ends_at < '2099-01-01T00:00:00Z' FROM public.featured_slots
    WHERE id = 'fb9c0002-0000-4000-8000-000000000002'),
  'direct sponsor writes changed nothing');

-- Reads: anon sees only the paid, active slot; owners see their own shop's slots; the platform admin sees all.
SET LOCAL ROLE anon;
SELECT pg_temp.assert_ids(
  (SELECT array_agg(id::text ORDER BY id) FROM public.featured_slots
    WHERE id::text LIKE 'fb9c0002-%' AND is_active AND slot_type = 'search_top'
      AND starts_at <= now() AND ends_at >= now()) = ARRAY['fb9c0002-0000-4000-8000-000000000002']
  AND (SELECT count(*) = 1 FROM public.featured_slots WHERE id::text LIKE 'fb9c0002-%'),
  'anon reads only the active slot for the sponsor block');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'fb9c0000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_ids(
  (SELECT array_agg(id::text ORDER BY id) FROM public.featured_slots WHERE id::text LIKE 'fb9c0002-%')
    = ARRAY['fb9c0002-0000-4000-8000-000000000001', 'fb9c0002-0000-4000-8000-000000000002'],
  'owner of A reads their unpaid slot and the public active slot');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'fb9c0000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_ids(
  NOT EXISTS(SELECT 1 FROM public.featured_slots WHERE id = 'fb9c0002-0000-4000-8000-000000000001'),
  'owner of B cannot read the unpaid slot of A');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'fb9c0000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_ids(
  (SELECT count(*) = 2 FROM public.featured_slots WHERE id::text LIKE 'fb9c0002-%'),
  'platform admin reads every slot');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- facility_qa
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_ids(
  NOT has_table_privilege('anon', 'public.facility_qa', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.facility_qa', 'SELECT')
  AND NOT has_column_privilege('anon', 'public.facility_qa', 'user_id', 'SELECT')
  AND NOT has_column_privilege('anon', 'public.facility_qa', 'answered_by', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.facility_qa', 'user_id', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.facility_qa', 'answered_by', 'SELECT')
  AND (SELECT bool_and(has_column_privilege(r, 'public.facility_qa', c, 'SELECT'))
    FROM unnest(ARRAY['anon', 'authenticated']) r
    CROSS JOIN unnest(ARRAY['id', 'facility_id', 'question', 'answer', 'status', 'is_public', 'created_at', 'answered_at']) c)
  AND NOT has_any_column_privilege('anon', 'public.facility_qa', 'INSERT')
  AND NOT has_any_column_privilege('authenticated', 'public.facility_qa', 'INSERT')
  AND NOT has_any_column_privilege('anon', 'public.facility_qa', 'UPDATE')
  AND NOT has_any_column_privilege('authenticated', 'public.facility_qa', 'UPDATE')
  AND has_column_privilege('service_role', 'public.facility_qa', 'user_id', 'SELECT')
  AND has_column_privilege('service_role', 'public.facility_qa', 'answered_by', 'SELECT'),
  'Q&A: browser roles read the shown columns only, never account IDs');

-- An answered public question and a pending one, stored as the API and the answer RPC do.
SET LOCAL ROLE service_role;
INSERT INTO public.facility_qa(id, facility_id, user_id, question, answer, status, is_public, answered_by, answered_at) VALUES
  ('fb9c0003-0000-4000-8000-000000000001', 'fb9c0001-0000-4000-8000-000000000001', 'fb9c0000-0000-4000-8000-000000000004',
   'Synthetic public question', 'Synthetic answer', 'answered', true, 'fb9c0000-0000-4000-8000-000000000001', now()),
  ('fb9c0003-0000-4000-8000-000000000002', 'fb9c0001-0000-4000-8000-000000000001', 'fb9c0000-0000-4000-8000-000000000004',
   'Synthetic pending question', NULL, 'pending', true, NULL, NULL);
RESET ROLE;

-- Anonymous visitors read the public question with the columns the facility page uses, and nothing else.
SET LOCAL ROLE anon;
DO $$ DECLARE rec record; BEGIN
  PERFORM pg_temp.assert_ids((SELECT count(*) = 1 FROM (
    SELECT id, question, answer, status, is_public, created_at, answered_at FROM public.facility_qa
    WHERE facility_id = 'fb9c0001-0000-4000-8000-000000000001' AND status = 'answered' AND is_public = true) q),
    'anon reads the published question with the page columns');
  BEGIN
    PERFORM user_id FROM public.facility_qa WHERE facility_id = 'fb9c0001-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'anon read the asker account ID';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM answered_by FROM public.facility_qa WHERE facility_id = 'fb9c0001-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'anon read the answering staff account ID';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    SELECT * INTO rec FROM public.facility_qa WHERE facility_id = 'fb9c0001-0000-4000-8000-000000000001' LIMIT 1;
    RAISE EXCEPTION 'anon read every Q&A column with select *';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- The owner reads both questions with the admin page columns, but not the account IDs.
SELECT set_config('request.jwt.claim.sub', 'fb9c0000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE rec record; BEGIN
  PERFORM pg_temp.assert_ids((SELECT count(*) = 2 FROM (
    SELECT id, facility_id, question, answer, answered_at, status, is_public, created_at FROM public.facility_qa
    WHERE facility_id = 'fb9c0001-0000-4000-8000-000000000001') q),
    'owner reads both questions with the admin page columns');
  BEGIN
    PERFORM user_id FROM public.facility_qa WHERE facility_id = 'fb9c0001-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'owner read the asker account ID';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    SELECT * INTO rec FROM public.facility_qa WHERE facility_id = 'fb9c0001-0000-4000-8000-000000000001' LIMIT 1;
    RAISE EXCEPTION 'owner read every Q&A column with select *';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_ids(
  (SELECT user_id = 'fb9c0000-0000-4000-8000-000000000004' AND answered_by = 'fb9c0000-0000-4000-8000-000000000001'
    FROM public.facility_qa WHERE id = 'fb9c0003-0000-4000-8000-000000000001'),
  'service_role still reads the asker and the answering staff member');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- review_helpful
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_ids(
  NOT has_any_column_privilege('anon', 'public.review_helpful', 'SELECT')
  AND NOT has_any_column_privilege('anon', 'public.review_helpful', 'INSERT')
  AND NOT has_any_column_privilege('anon', 'public.review_helpful', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.review_helpful', 'DELETE')
  AND has_table_privilege('authenticated', 'public.review_helpful', 'SELECT')
  AND has_table_privilege('authenticated', 'public.review_helpful', 'DELETE')
  AND has_column_privilege('authenticated', 'public.review_helpful', 'review_id', 'INSERT')
  AND has_column_privilege('authenticated', 'public.review_helpful', 'user_id', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.review_helpful', 'id', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.review_helpful', 'created_at', 'INSERT')
  AND NOT has_any_column_privilege('authenticated', 'public.review_helpful', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.review_helpful', 'TRUNCATE')
  AND has_table_privilege('service_role', 'public.review_helpful', 'SELECT'),
  'helpful votes: anon has nothing, signed-in users manage only their own');
SELECT pg_temp.assert_ids(
  (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'review_helpful') = ARRAY['review_helpful_user_manage'],
  'only the own-row policy remains on helpful votes');
SELECT pg_temp.assert_ids(
  (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
    WHERE oid = 'public.get_review_helpful_counts(uuid[])'::regprocedure)
  AND has_function_privilege('anon', 'public.get_review_helpful_counts(uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_review_helpful_counts(uuid[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.get_review_helpful_counts(uuid[])', 'EXECUTE'),
  'count function is a definer with a fixed search_path, callable by the pages');

-- 01 public review of A, 02 hidden review of A, 03 flagged review of A, 04 review of the draft shop C.
SET LOCAL ROLE service_role;
INSERT INTO public.facility_reviews(id, facility_id, reviewer_name, rating, status, is_flagged, reviewer_ip) VALUES
  ('fb9c0004-0000-4000-8000-000000000001', 'fb9c0001-0000-4000-8000-000000000001', 'Synthetic public', 4, 'published', false, '192.0.2.91'),
  ('fb9c0004-0000-4000-8000-000000000002', 'fb9c0001-0000-4000-8000-000000000001', 'Synthetic hidden', 4, 'hidden', false, '192.0.2.92'),
  ('fb9c0004-0000-4000-8000-000000000003', 'fb9c0001-0000-4000-8000-000000000001', 'Synthetic flagged', 4, 'published', true, '192.0.2.93'),
  ('fb9c0004-0000-4000-8000-000000000004', 'fb9c0001-0000-4000-8000-000000000003', 'Synthetic draft shop', 4, 'published', false, '192.0.2.94');
INSERT INTO public.review_helpful(review_id, user_id) VALUES
  ('fb9c0004-0000-4000-8000-000000000001', 'fb9c0000-0000-4000-8000-000000000005'),
  ('fb9c0004-0000-4000-8000-000000000001', 'fb9c0000-0000-4000-8000-000000000006'),
  ('fb9c0004-0000-4000-8000-000000000002', 'fb9c0000-0000-4000-8000-000000000005'),
  ('fb9c0004-0000-4000-8000-000000000003', 'fb9c0000-0000-4000-8000-000000000006'),
  ('fb9c0004-0000-4000-8000-000000000004', 'fb9c0000-0000-4000-8000-000000000005');
RESET ROLE;

-- Anonymous visitors get counts for public reviews only, and cannot read any vote row.
SET LOCAL ROLE anon;
SELECT pg_temp.assert_ids(
  (SELECT array_agg(review_id::text || '=' || helpful_count ORDER BY review_id)
    FROM public.get_review_helpful_counts(ARRAY['fb9c0004-0000-4000-8000-000000000001', 'fb9c0004-0000-4000-8000-000000000002',
      'fb9c0004-0000-4000-8000-000000000003', 'fb9c0004-0000-4000-8000-000000000004']::uuid[]))
    = ARRAY['fb9c0004-0000-4000-8000-000000000001=2'],
  'anon gets counts only, for public reviews only');
DO $$ BEGIN
  BEGIN
    PERFORM user_id FROM public.review_helpful;
    RAISE EXCEPTION 'anon read helpful voter account IDs';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM review_id FROM public.review_helpful;
    RAISE EXCEPTION 'anon read helpful vote rows';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- A voter reads only their own votes, toggles them, and cannot vote as or remove someone else.
SELECT set_config('request.jwt.claim.sub', 'fb9c0000-0000-4000-8000-000000000005', true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
  PERFORM pg_temp.assert_ids(
    (SELECT array_agg(review_id::text ORDER BY review_id) FROM public.review_helpful
      WHERE user_id = 'fb9c0000-0000-4000-8000-000000000005' AND review_id::text LIKE 'fb9c0004-%')
      = ARRAY['fb9c0004-0000-4000-8000-000000000001', 'fb9c0004-0000-4000-8000-000000000002',
              'fb9c0004-0000-4000-8000-000000000004'],
    'a voter reads their own votes');
  PERFORM pg_temp.assert_ids(NOT EXISTS(SELECT 1 FROM public.review_helpful
    WHERE review_id::text LIKE 'fb9c0004-%' AND user_id <> 'fb9c0000-0000-4000-8000-000000000005'),
    'a voter cannot see other voters');
  PERFORM pg_temp.assert_ids((SELECT helpful_count = 2 FROM public.get_review_helpful_counts(
    ARRAY['fb9c0004-0000-4000-8000-000000000001']::uuid[])), 'signed-in users get the same counts');
  DELETE FROM public.review_helpful
    WHERE review_id = 'fb9c0004-0000-4000-8000-000000000001' AND user_id = 'fb9c0000-0000-4000-8000-000000000005';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.assert_ids(n = 1, 'a voter removes their own vote');
  INSERT INTO public.review_helpful(review_id, user_id)
    VALUES ('fb9c0004-0000-4000-8000-000000000001', 'fb9c0000-0000-4000-8000-000000000005');
  DELETE FROM public.review_helpful
    WHERE review_id = 'fb9c0004-0000-4000-8000-000000000001' AND user_id = 'fb9c0000-0000-4000-8000-000000000006';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.assert_ids(n = 0, 'a voter cannot remove someone else''s vote');
  BEGIN
    INSERT INTO public.review_helpful(review_id, user_id)
      VALUES ('fb9c0004-0000-4000-8000-000000000003', 'fb9c0000-0000-4000-8000-000000000007');
    RAISE EXCEPTION 'vote recorded under another account';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.review_helpful SET review_id = 'fb9c0004-0000-4000-8000-000000000003'
      WHERE user_id = 'fb9c0000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'vote moved to another review';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.assert_ids(
  (SELECT count(*) = 5 FROM public.review_helpful WHERE review_id::text LIKE 'fb9c0004-%')
  AND EXISTS(SELECT 1 FROM public.review_helpful WHERE review_id = 'fb9c0004-0000-4000-8000-000000000001'
    AND user_id = 'fb9c0000-0000-4000-8000-000000000006')
  AND NOT EXISTS(SELECT 1 FROM public.review_helpful WHERE user_id = 'fb9c0000-0000-4000-8000-000000000007'),
  'only the voter''s own toggle changed the votes');
SELECT set_config('request.jwt.claim.sub', 'fb9c0000-0000-4000-8000-000000000007', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_ids(NOT EXISTS(SELECT 1 FROM public.review_helpful WHERE review_id::text LIKE 'fb9c0004-%'),
  'a signed-in stranger reads no vote rows');
RESET ROLE;
ROLLBACK;
