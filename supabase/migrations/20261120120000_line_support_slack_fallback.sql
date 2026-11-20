-- LINE support: when no AI draft can be produced, finish the event without a LINE delivery
-- so the operator can be notified on Slack exactly once. No sends happen in the database.
BEGIN;
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL OR to_regclass('public.line_support_events') IS NULL THEN
    RAISE EXCEPTION 'CareLink database with LINE support required';
  END IF;
END $guard$;

-- Returns 'completed' only to the current lease holder, so the caller notifies once per event.
CREATE FUNCTION public.complete_line_support_without_delivery(p_event_id text,p_lease_id uuid,p_draft_id uuid,p_knowledge_revision text,p_body text,p_model_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE e public.line_support_events; c public.line_support_conversations;
BEGIN
  IF p_body IS NULL OR length(p_body) NOT BETWEEN 1 AND 2400 THEN
    RAISE EXCEPTION 'Invalid notice' USING ERRCODE='22023'; END IF;
  SELECT * INTO e FROM public.line_support_events WHERE event_id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','stale'); END IF;
  SELECT * INTO c FROM public.line_support_conversations WHERE id=e.conversation_id FOR UPDATE;
  IF e.state<>'processing' OR e.lease_id IS DISTINCT FROM p_lease_id OR e.lease_until<=now()
     OR c.revision<>e.revision OR c.blocked THEN RETURN jsonb_build_object('status','stale'); END IF;
  INSERT INTO public.line_support_drafts(id,conversation_id,conversation_revision,knowledge_revision,body,model_version)
    VALUES(p_draft_id,c.id,c.revision,p_knowledge_revision,p_body,p_model_version);
  UPDATE public.line_support_conversations SET mode='human' WHERE id=c.id;
  UPDATE public.line_support_events SET state='done',lease_id=NULL,lease_until=NULL WHERE event_id=p_event_id;
  RETURN jsonb_build_object('status','completed','draft_id',p_draft_id);
END $fn$;

REVOKE ALL ON FUNCTION public.complete_line_support_without_delivery(text,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_line_support_without_delivery(text,uuid,uuid,text,text,text) TO service_role;
COMMIT;
