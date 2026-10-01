-- Disposable DB only. Synthetic records, no provider I/O; rollback all fixtures.
BEGIN;
SET LOCAL statement_timeout = '10s';
INSERT INTO public.contacts(id, name, email, inquiry_type, message)
VALUES ('11111111-1111-4111-8111-111111111111', 'TEST-reply-fixture', 'test@example.invalid', '施設掲載について', 'TEST');
SET LOCAL ROLE service_role;
INSERT INTO public.contact_replies(id, contact_id, body, delivery_envelope)
VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'TEST-reserved',
 '{"from":"TEST <test@example.invalid>","to":"test@example.invalid","replyTo":"test@example.invalid","subject":"TEST","html":"<p>TEST</p>"}');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.contact_replies(contact_id, body)
    VALUES ('11111111-1111-4111-8111-111111111111', 'TEST-duplicate');
    RAISE EXCEPTION 'pending uniqueness guard missing';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    UPDATE public.contact_replies SET delivery_envelope = '{}' WHERE id = '22222222-2222-4222-8222-222222222222';
    RAISE EXCEPTION 'envelope mutation accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.contact_replies SET body = 'TEST-changed' WHERE id = '22222222-2222-4222-8222-222222222222';
    RAISE EXCEPTION 'body mutation accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.contact_replies SET provider_message_id = '33333333-3333-4333-8333-333333333333'
      WHERE id = '22222222-2222-4222-8222-222222222222';
    RAISE EXCEPTION 'acceptance without timestamp accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE public.contact_replies SET sent_at = now(), provider_message_id = '33333333-3333-4333-8333-333333333333'
 WHERE id = '22222222-2222-4222-8222-222222222222';
DO $$
BEGIN
  BEGIN
    UPDATE public.contact_replies SET sent_at = NULL WHERE id = '22222222-2222-4222-8222-222222222222';
    RAISE EXCEPTION 'confirmed operation reset accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.contact_replies(contact_id, body, delivery_envelope, sent_at, provider_message_id)
    VALUES ('11111111-1111-4111-8111-111111111111', 'TEST-other', '{}', now(), '33333333-3333-4333-8333-333333333333');
    RAISE EXCEPTION 'provider record reused';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.contact_replies) THEN RAISE EXCEPTION 'anonymous reply read'; END IF;
  BEGIN
    INSERT INTO public.contact_replies(contact_id, body) VALUES ('11111111-1111-4111-8111-111111111111', 'TEST-anon');
    RAISE EXCEPTION 'anonymous reply write';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.contact_replies) THEN RAISE EXCEPTION 'authenticated reply read'; END IF;
  BEGIN
    INSERT INTO public.contact_replies(contact_id, body) VALUES ('11111111-1111-4111-8111-111111111111', 'TEST-auth');
    RAISE EXCEPTION 'authenticated reply write';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
