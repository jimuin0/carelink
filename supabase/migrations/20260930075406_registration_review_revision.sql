-- Observed-state concurrency token; status alone permits ABA on explicit reopen.
ALTER TABLE public.salons ADD COLUMN review_revision integer NOT NULL DEFAULT 0
  CHECK (review_revision >= 0);

CREATE FUNCTION public.bump_salon_review_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Never trust a writer's replacement revision. Integer overflow fails closed.
  NEW.review_revision := OLD.review_revision + 1;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bump_salon_review_revision() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_salon_review_revision() TO service_role;
CREATE TRIGGER salons_review_revision_before_update
  BEFORE UPDATE ON public.salons FOR EACH ROW
  EXECUTE FUNCTION public.bump_salon_review_revision();
