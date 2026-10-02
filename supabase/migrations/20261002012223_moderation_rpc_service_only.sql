-- Keep the existing moderation implementation and queue data unchanged.
-- Only trusted server-side callers may bypass queue RLS through this RPC.
REVOKE ALL ON FUNCTION public.enqueue_moderation(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_moderation(jsonb) TO service_role;
