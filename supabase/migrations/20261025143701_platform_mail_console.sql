-- Shared operator mailbox. No direct browser access or new background scheduler.
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL OR to_regclass('public.contact_replies') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END $guard$;

CREATE TABLE public.platform_mail (
  id uuid PRIMARY KEY,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  recipient text NOT NULL DEFAULT '' CHECK (char_length(recipient) <= 254),
  subject text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 200 AND subject !~ E'[\r\n]'),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 10000),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','pending','scheduled','sent','cancelling','cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  scheduled_at timestamptz,
  envelope jsonb,
  provider_message_id uuid UNIQUE,
  reserved_at timestamptz,
  accepted_at timestamptz,
  delivery_status text CHECK (delivery_status IN ('accepted','scheduled','sent','delivered','delayed','bounced','complained','cancelled','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_mail_reservation CHECK ((state='draft' AND envelope IS NULL AND reserved_at IS NULL AND provider_message_id IS NULL)
    OR (state<>'draft' AND envelope IS NOT NULL AND reserved_at IS NOT NULL)),
  CONSTRAINT platform_mail_acceptance CHECK (state IN ('draft','pending') OR (provider_message_id IS NOT NULL AND accepted_at IS NOT NULL))
);
CREATE INDEX platform_mail_folder_cursor ON public.platform_mail (state, updated_at DESC, id DESC);
CREATE INDEX platform_mail_contact ON public.platform_mail (contact_id) WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX platform_mail_contact_pending ON public.platform_mail (contact_id) WHERE state IN ('pending','scheduled','cancelling') AND contact_id IS NOT NULL;
ALTER TABLE public.platform_mail ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_mail FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.platform_mail TO service_role;

-- The existing inquiry composer and the new mailbox share a contact-row fence.
-- Neither interface may create a second uncertain reply while the other owns it.
CREATE FUNCTION public.guard_platform_mail_inquiry_overlap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.is_internal=false AND NEW.sent_at IS NULL AND NEW.delivery_abandoned_at IS NULL THEN
    PERFORM 1 FROM public.contacts WHERE id=NEW.contact_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.platform_mail WHERE contact_id=NEW.contact_id AND state IN ('pending','scheduled','cancelling')) THEN
      RAISE EXCEPTION 'a mail operation is pending' USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_platform_mail_inquiry_overlap() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_platform_mail_inquiry_overlap() TO service_role;
CREATE TRIGGER guard_platform_mail_inquiry_overlap BEFORE INSERT ON public.contact_replies
FOR EACH ROW EXECUTE FUNCTION public.guard_platform_mail_inquiry_overlap();

CREATE FUNCTION public.manage_platform_mail_atomic(p_actor_id uuid,p_mail_id uuid,p_action text,p_values jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  mail public.platform_mail;
  expected integer;
  contact_email text;
  requested_contact uuid;
  reserved_envelope jsonb;
  provider_id uuid;
  observed text;
BEGIN
  -- Service-role is only the server transport. The current DB privilege is locked
  -- for every read/write, including retries after a role was revoked.
  PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND is_platform_admin=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'operator required' USING ERRCODE='42501'; END IF;
  IF p_mail_id IS NULL OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
  END IF;
  SELECT * INTO mail FROM public.platform_mail WHERE id=p_mail_id FOR UPDATE;
  IF p_action='save' THEN
    expected:=(p_values->>'revision')::integer;
    requested_contact:=(p_values->>'contactId')::uuid;
    IF requested_contact IS NOT NULL THEN
      SELECT email INTO contact_email FROM public.contacts WHERE id=requested_contact FOR UPDATE;
      IF NOT FOUND OR contact_email IS NULL OR contact_email<>p_values->>'to' THEN
        RAISE EXCEPTION 'contact changed' USING ERRCODE='40001';
      END IF;
    END IF;
    IF (p_values->>'to') IS NULL OR (p_values->>'subject') IS NULL OR (p_values->>'body') IS NULL THEN
      RAISE EXCEPTION 'incomplete draft' USING ERRCODE='22023';
    END IF;
    IF mail.id IS NULL THEN
      IF expected IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'stale draft' USING ERRCODE='40001'; END IF;
      INSERT INTO public.platform_mail(id,created_by,contact_id,recipient,subject,body,scheduled_at)
        VALUES(p_mail_id,p_actor_id,requested_contact,p_values->>'to',p_values->>'subject',p_values->>'body',(p_values->>'scheduledAt')::timestamptz)
        RETURNING * INTO mail;
    ELSE
      IF mail.state<>'draft' OR mail.revision IS DISTINCT FROM expected OR mail.contact_id IS DISTINCT FROM requested_contact THEN
        RAISE EXCEPTION 'stale or frozen draft' USING ERRCODE='40001';
      END IF;
      UPDATE public.platform_mail SET recipient=p_values->>'to',subject=p_values->>'subject',body=p_values->>'body',
        scheduled_at=(p_values->>'scheduledAt')::timestamptz,revision=revision+1,updated_at=now()
        WHERE id=p_mail_id RETURNING * INTO mail;
    END IF;
    RETURN to_jsonb(mail);
  END IF;
  IF mail.id IS NULL THEN RAISE EXCEPTION 'mail not found' USING ERRCODE='P0002'; END IF;
  IF p_action='read' THEN RETURN to_jsonb(mail); END IF;

  IF p_action='reserve' THEN
    IF mail.state='pending' THEN RETURN to_jsonb(mail); END IF;
    IF mail.state<>'draft' OR mail.revision IS DISTINCT FROM (p_values->>'revision')::integer THEN
      RAISE EXCEPTION 'stale or frozen draft' USING ERRCODE='40001';
    END IF;
    IF mail.contact_id IS NOT NULL THEN
      SELECT email INTO contact_email FROM public.contacts WHERE id=mail.contact_id FOR UPDATE;
      IF NOT FOUND OR contact_email IS DISTINCT FROM mail.recipient THEN RAISE EXCEPTION 'contact changed' USING ERRCODE='40001'; END IF;
      IF EXISTS(SELECT 1 FROM public.contact_replies WHERE contact_id=mail.contact_id AND is_internal=false AND sent_at IS NULL AND delivery_abandoned_at IS NULL)
        OR EXISTS(SELECT 1 FROM public.platform_mail WHERE contact_id=mail.contact_id AND id<>mail.id AND state IN ('pending','scheduled','cancelling')) THEN
        RAISE EXCEPTION 'an inquiry reply is pending' USING ERRCODE='40001';
      END IF;
    END IF;
    reserved_envelope:=p_values->'envelope';
    IF jsonb_typeof(reserved_envelope) IS DISTINCT FROM 'object'
      OR reserved_envelope->>'from' IS DISTINCT FROM 'CareLink <support@carelink-jp.com>'
      OR reserved_envelope->>'replyTo' IS DISTINCT FROM 'support@carelink-jp.com'
      OR reserved_envelope->>'to' IS DISTINCT FROM mail.recipient OR mail.recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      OR reserved_envelope->>'subject' IS DISTINCT FROM mail.subject OR btrim(mail.subject)=''
      OR reserved_envelope->>'text' IS DISTINCT FROM mail.body OR btrim(mail.body)=''
      OR (reserved_envelope->>'scheduledAt')::timestamptz IS DISTINCT FROM mail.scheduled_at
      OR (mail.scheduled_at IS NOT NULL AND (mail.scheduled_at<now()+interval '1 minute' OR mail.scheduled_at>now()+interval '30 days')) THEN
      RAISE EXCEPTION 'invalid immutable envelope' USING ERRCODE='22023';
    END IF;
    UPDATE public.platform_mail SET state='pending',envelope=reserved_envelope,reserved_at=now(),revision=revision+1,updated_at=now()
      WHERE id=p_mail_id RETURNING * INTO mail;
    RETURN to_jsonb(mail);
  END IF;
  IF p_action='cancel' THEN
    IF mail.state NOT IN ('scheduled','cancelling') THEN RAISE EXCEPTION 'not scheduled' USING ERRCODE='40001'; END IF;
    UPDATE public.platform_mail SET state='cancelling',revision=revision+1,updated_at=now() WHERE id=p_mail_id RETURNING * INTO mail;
    RETURN to_jsonb(mail);
  END IF;
  IF p_action='observe' THEN
    provider_id:=(p_values->>'providerId')::uuid;
    observed:=p_values->>'event';
    IF mail.state='draft' OR provider_id IS NULL OR (mail.provider_message_id IS NOT NULL AND mail.provider_message_id<>provider_id)
      OR observed IS NULL OR observed NOT IN ('accepted','scheduled','sent','delivered','delayed','bounced','complained','cancelled','failed') THEN
      RAISE EXCEPTION 'invalid provider receipt' USING ERRCODE='22023';
    END IF;
    IF mail.state='cancelled' THEN RETURN to_jsonb(mail); END IF;
    IF (mail.state='sent' AND observed IN ('scheduled','cancelled','accepted')) OR (mail.state='cancelling' AND observed='accepted') THEN RETURN to_jsonb(mail); END IF;
    UPDATE public.platform_mail SET provider_message_id=provider_id,accepted_at=coalesce(accepted_at,now()),delivery_status=observed,
      state=CASE WHEN observed='cancelled' THEN 'cancelled' WHEN observed='scheduled' THEN CASE WHEN state='cancelling' THEN 'cancelling' ELSE 'scheduled' END
        WHEN observed='accepted' AND scheduled_at IS NOT NULL THEN 'scheduled' ELSE 'sent' END,
      revision=revision+1,updated_at=now() WHERE id=p_mail_id RETURNING * INTO mail;
    RETURN to_jsonb(mail);
  END IF;
  RAISE EXCEPTION 'invalid action' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.manage_platform_mail_atomic(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_platform_mail_atomic(uuid,uuid,text,jsonb) TO service_role;
