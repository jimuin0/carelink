-- Count a referral use in the same transaction that creates it. The old
-- consumer's later CAS now matches zero rows because the count is already
-- incremented; it cannot overwrite the authoritative increment.
CREATE FUNCTION public.guard_referral_use_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid; current_owner uuid;
BEGIN
  SELECT c.user_id INTO owner_id FROM public.referral_codes c WHERE c.code=NEW.code;
  IF NOT FOUND THEN RAISE EXCEPTION 'REFERRAL_CODE_INVALID'; END IF;
  PERFORM public.lock_booking_point_actors(NEW.referred_user_id,owner_id);
  SELECT c.user_id INTO current_owner FROM public.referral_codes c WHERE c.code=NEW.code FOR UPDATE;
  IF NOT FOUND OR current_owner IS DISTINCT FROM owner_id OR NEW.referrer_user_id IS DISTINCT FROM owner_id
    THEN RAISE EXCEPTION 'REFERRAL_CODE_INVALID'; END IF;
  IF NEW.referred_user_id=owner_id THEN RAISE EXCEPTION 'REFERRAL_SELF_USE'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_referral_use_actor() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_referral_use_actor BEFORE INSERT ON public.referral_uses
  FOR EACH ROW EXECUTE FUNCTION public.guard_referral_use_actor();

CREATE FUNCTION public.count_referral_use_atomic() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed uuid;
BEGIN
  UPDATE public.referral_codes c SET used_count=coalesce(c.used_count,0)+1
    WHERE c.code=NEW.code AND c.user_id=NEW.referrer_user_id RETURNING c.id INTO changed;
  IF changed IS NULL THEN RAISE EXCEPTION 'REFERRAL_COUNT_NOT_CONFIRMED'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.count_referral_use_atomic() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER count_referral_use_atomic AFTER INSERT ON public.referral_uses
  FOR EACH ROW EXECUTE FUNCTION public.count_referral_use_atomic();

CREATE FUNCTION public.apply_referral_code_atomic(p_user_id uuid,p_code text)
RETURNS TABLE(use_id uuid,code text,replayed boolean) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE owner_id uuid; c public.referral_codes%ROWTYPE; u public.referral_uses%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_code IS NULL OR length(p_code) NOT BETWEEN 1 AND 100
    THEN RAISE EXCEPTION 'REFERRAL_CODE_INVALID'; END IF;
  SELECT r.user_id INTO owner_id FROM public.referral_codes r WHERE r.code=upper(p_code);
  IF NOT FOUND THEN RAISE EXCEPTION 'REFERRAL_CODE_INVALID'; END IF;
  PERFORM public.lock_booking_point_actors(p_user_id,owner_id);
  SELECT r.* INTO c FROM public.referral_codes r WHERE r.code=upper(p_code) FOR UPDATE;
  IF NOT FOUND OR c.user_id IS DISTINCT FROM owner_id THEN RAISE EXCEPTION 'REFERRAL_CODE_INVALID'; END IF;
  IF c.user_id=p_user_id THEN RAISE EXCEPTION 'REFERRAL_SELF_USE'; END IF;
  SELECT r.* INTO u FROM public.referral_uses r WHERE r.referred_user_id=p_user_id FOR UPDATE;
  IF FOUND THEN
    IF u.code IS DISTINCT FROM c.code OR u.referrer_user_id IS DISTINCT FROM c.user_id
      THEN RAISE EXCEPTION 'REFERRAL_ALREADY_APPLIED'; END IF;
    RETURN QUERY SELECT u.id,u.code,true; RETURN;
  END IF;
  INSERT INTO public.referral_uses(code,referred_user_id,referrer_user_id)
    VALUES(c.code,p_user_id,c.user_id) RETURNING * INTO u;
  RETURN QUERY SELECT u.id,u.code,false;
END $$;
REVOKE ALL ON FUNCTION public.apply_referral_code_atomic(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_referral_code_atomic(uuid,text) TO service_role;
