-- M08. Aggregate inside one statement, not an implicitly 1000-row-capped
-- PostgREST scan. Explicit current membership protects the service-role read.
CREATE FUNCTION public.get_chain_statistics(p_actor_id uuid,p_facility_ids uuid[],p_month_start timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_month_start IS NULL OR p_facility_ids IS NULL
    OR cardinality(p_facility_ids) NOT BETWEEN 1 AND 100
    OR cardinality(p_facility_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_facility_ids) id)
    THEN RAISE EXCEPTION 'CHAIN_INPUT_INVALID'; END IF;
  PERFORM 1 FROM public.facility_members WHERE user_id=p_actor_id AND facility_id=ANY(p_facility_ids)
    AND role IN ('owner','admin') FOR SHARE;
  IF (SELECT count(DISTINCT facility_id) FROM public.facility_members WHERE user_id=p_actor_id
    AND facility_id=ANY(p_facility_ids) AND role IN ('owner','admin')) <> cardinality(p_facility_ids)
    THEN RAISE EXCEPTION 'CHAIN_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', f.id, 'booking_count', b.total,
    'monthly_bookings', b.monthly, 'review_count', r.total, 'rating_avg', COALESCE(r.average,0),
    'nps_score', n.score) ORDER BY f.id),'[]'::jsonb) INTO result
  FROM public.facility_profiles f
  CROSS JOIN LATERAL (SELECT count(*) AS total, count(*) FILTER(WHERE created_at>=p_month_start) AS monthly
    FROM public.bookings WHERE facility_id=f.id) b
  CROSS JOIN LATERAL (SELECT count(*) AS total, avg(rating) AS average
    FROM public.public_reviews WHERE facility_id=f.id) r
  CROSS JOIN LATERAL (SELECT CASE WHEN count(*)=0 THEN NULL ELSE
    round(100.0 * (count(*) FILTER(WHERE score>=9)-count(*) FILTER(WHERE score<=6))/count(*)) END AS score
    FROM public.nps_surveys WHERE facility_id=f.id) n
  WHERE f.id=ANY(p_facility_ids);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_chain_statistics(uuid,uuid[],timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_chain_statistics(uuid,uuid[],timestamptz) TO service_role;
