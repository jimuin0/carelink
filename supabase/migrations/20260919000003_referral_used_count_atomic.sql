-- CL-16: 紹介コード使用回数を同時実行安全に更新するRPC。
DO $guard$
BEGIN
  IF to_regclass('public.referral_codes') IS NULL THEN
    RAISE EXCEPTION 'referral_codesが見つかりません。接続先を確認してください。';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.increment_referral_code_used_count(p_code text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  next_count integer;
BEGIN
  UPDATE public.referral_codes
     SET used_count = COALESCE(used_count, 0) + 1
   WHERE code = upper(btrim(p_code))
   RETURNING used_count INTO next_count;
  RETURN next_count;
END
$function$;

REVOKE ALL ON FUNCTION public.increment_referral_code_used_count(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_referral_code_used_count(text) TO service_role;
