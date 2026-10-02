-- M07. A reservation state transition and its visit must commit together.
-- Abort on legacy inconsistencies instead of deleting or merging real history.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.customer_visits WHERE booking_id IS NOT NULL GROUP BY booking_id HAVING count(*)>1)
    THEN RAISE EXCEPTION 'VISIT_PREFLIGHT_DUPLICATE_BOOKING'; END IF;
  IF EXISTS (SELECT 1 FROM public.customer_visits v JOIN public.bookings b ON b.id=v.booking_id WHERE v.facility_id<>b.facility_id)
    THEN RAISE EXCEPTION 'VISIT_PREFLIGHT_FACILITY_MISMATCH'; END IF;
END $$;
ALTER TABLE public.customer_visits ALTER COLUMN customer_email DROP NOT NULL;
CREATE UNIQUE INDEX customer_visits_booking_id_unique ON public.customer_visits(booking_id);
DROP POLICY IF EXISTS customer_visits_member_insert ON public.customer_visits;
CREATE POLICY customer_visits_member_insert ON public.customer_visits FOR INSERT TO authenticated
WITH CHECK (booking_id IS NULL AND EXISTS (SELECT 1 FROM public.facility_members fm
  WHERE fm.facility_id=customer_visits.facility_id AND fm.user_id=auth.uid() AND fm.role IN ('owner','admin')));

CREATE FUNCTION public.sync_booking_visit() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path='' AS $$
DECLARE v_menu_name text; v_staff_name text;
BEGIN
  IF NEW.status='completed' THEN
    SELECT string_agg(m.name,'、' ORDER BY chosen.ordinal) INTO v_menu_name
      FROM unnest(CASE WHEN cardinality(NEW.menu_ids)>0 THEN NEW.menu_ids ELSE ARRAY[NEW.menu_id] END)
      WITH ORDINALITY chosen(id,ordinal) JOIN public.facility_menus m ON m.id=chosen.id AND m.facility_id=NEW.facility_id;
    SELECT name INTO v_staff_name FROM public.staff_profiles WHERE id=NEW.staff_id AND facility_id=NEW.facility_id;
    INSERT INTO public.customer_visits(facility_id,booking_id,customer_email,customer_name,visit_date,menu_name,staff_name,amount)
      VALUES(NEW.facility_id,NEW.id,NEW.email,NEW.customer_name,NEW.booking_date,v_menu_name,v_staff_name,NEW.total_price)
    ON CONFLICT (booking_id) DO UPDATE SET customer_email=EXCLUDED.customer_email,
      customer_name=EXCLUDED.customer_name,visit_date=EXCLUDED.visit_date,amount=EXCLUDED.amount,
      menu_name=COALESCE(EXCLUDED.menu_name,customer_visits.menu_name),staff_name=COALESCE(EXCLUDED.staff_name,customer_visits.staff_name)
    WHERE customer_visits.facility_id=EXCLUDED.facility_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'VISIT_FACILITY_MISMATCH'; END IF;
  ELSIF TG_OP='UPDATE' AND OLD.status='completed' THEN
    DELETE FROM public.customer_visits WHERE booking_id=NEW.id AND facility_id=OLD.facility_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_booking_visit() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER booking_visit_atomic AFTER INSERT OR UPDATE OF status,total_price,customer_name,email,booking_date,menu_id,menu_ids,staff_id,facility_id
ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.sync_booking_visit();

-- Customers with no email are separate reservation histories, not a single
-- anonymous person. Never fabricate emails or merge by name.
CREATE OR REPLACE FUNCTION public.get_unique_customers(p_facility_id uuid)
RETURNS TABLE(email text,name text,visit_count bigint,last_visit date)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  WITH ranked AS (
    SELECT customer_email,customer_name,
      row_number() OVER (PARTITION BY COALESCE(email_canonical,customer_email) ORDER BY visit_date DESC,id) AS rn,
      count(*) OVER (PARTITION BY COALESCE(email_canonical,customer_email)) AS cnt,
      max(visit_date) OVER (PARTITION BY COALESCE(email_canonical,customer_email)) AS maxd
    FROM public.customer_visits WHERE facility_id=p_facility_id AND nullif(btrim(customer_email),'') IS NOT NULL
  ) SELECT customer_email,customer_name,cnt,maxd FROM ranked WHERE rn=1 ORDER BY maxd DESC;
$$;
REVOKE ALL ON FUNCTION public.get_unique_customers(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_unique_customers(uuid) TO authenticated,service_role;
