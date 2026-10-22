-- 非公開・停止になった施設のお気に入りを、お客様が外せなかった（2026年10月23日）。
--
-- 【症状】toggle_user_favorite_atomic（20261018140406）は、p_desired の値に関係なく最初に
--   「施設が published か」を確認し、そうでなければ P0002（FAVORITE_FACILITY_UNAVAILABLE）を投げていた。
--   そのため、オーナーが掲載を「下書き」「停止」に戻した施設や、最後のオーナーが退会して停止になった施設は、
--   お気に入りから外す操作（p_desired=false）でも DELETE まで届かず、/api/favorites は 404 を返していた。
--   ブラウザのロールは favorites へ書けない（同 migration で REVOKE 済み）ので、外す経路は他に無い。
--   マイページの「お気に入り施設」には外せないカードが残り、ダッシュボードの件数にも数えられ続けていた。
--
-- 【直し方】published の確認を、行が増える（INSERT する）経路だけに移す。
--   - p_desired=false: 施設の状態を見ずに削除して false を返す。
--   - p_desired=NULL（トグル）: 先に削除する。消えたら false。消えなかったときだけ published を確認して追加する。
--   - p_desired=true: これまでどおり published を確認してから追加する（非公開の施設へは追加できない）。
--   アカウントのロック（lock_booking_account）と利用者×施設のアドバイザリロックは、どの経路でも最初に取る（従来どおり）。
--   削除の経路で施設行をロックしなくても、非公開化との競合で困ることは無い（非公開の施設に行が増えることは無い）。
--   関数の本文以外（引数・既定値・戻り値・SECURITY INVOKER・search_path・権限）は 20261018140406 と同じ。
--
-- 【適用順】アプリのデプロイより【前】に適用する（どちらの順でも壊れはしない）。
--   旧アプリ（origin/fix/fourth-sweep-integration）はこの RPC を同じ引数で呼ぶだけで、追加の挙動は変わらない。
--   新アプリはマイページの「お気に入りから外す」で p_desired=false を送る。この migration より先にデプロイすると、
--   非公開の施設に対してはこれまでどおり 404 になり、ボタンはエラーを表示する（データは壊れない）。
DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

CREATE OR REPLACE FUNCTION public.toggle_user_favorite_atomic(p_actor_id uuid, p_facility_id uuid, p_desired boolean DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE removed_id uuid;
BEGIN
 IF p_actor_id IS NULL OR p_facility_id IS NULL THEN
  RAISE EXCEPTION 'INVALID_FAVORITE_SCOPE' USING ERRCODE='22023';
 END IF;
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('favorite:'||p_actor_id::text||':'||p_facility_id::text,0));
 -- Removal never depends on the facility's publication state.
 IF p_desired IS NOT true THEN
  DELETE FROM public.favorites WHERE user_id=p_actor_id AND facility_id=p_facility_id RETURNING id INTO removed_id;
  IF p_desired IS false OR FOUND THEN RETURN false; END IF;
 END IF;
 -- Only an addition requires a currently published facility (held until commit).
 PERFORM 1 FROM public.facility_profiles WHERE id=p_facility_id AND status='published' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FAVORITE_FACILITY_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.favorites(user_id,facility_id) VALUES(p_actor_id,p_facility_id)
  ON CONFLICT(user_id,facility_id) DO NOTHING;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.toggle_user_favorite_atomic(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_user_favorite_atomic(uuid,uuid,boolean) TO service_role;
