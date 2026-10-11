-- A single MVCC snapshot aggregates the complete ledger without API row caps.
-- Invoker permissions and RLS remain in force; ordinary callers may read only
-- their own balance. Verified server-side LIFF resolution uses service_role.
CREATE FUNCTION public.get_user_points_balance(p_user_id uuid)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp AS $$
BEGIN
  IF p_user_id IS NULL OR
    (current_user <> 'service_role' AND p_user_id IS DISTINCT FROM (SELECT auth.uid())) THEN
    RAISE EXCEPTION 'POINTS_BALANCE_OWNER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT COALESCE(SUM(points), 0) FROM public.user_points WHERE user_id = p_user_id);
END $$;
REVOKE ALL ON FUNCTION public.get_user_points_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_points_balance(uuid) TO authenticated, service_role;
