-- 点検 A66（2026年11月13日・神原さん決定「新規だけ制限・既存は残す」）：
-- 店舗写真（facility_photos）にブラウザから書ける URL を、自社 Storage の photos バケット・
-- 自施設フォルダ（photos/facilities/<facility_id>/...）に限る。
--
-- 以前（20260627000003）は owner/admin であれば photo_url に任意の外部 URL を INSERT/UPDATE できた。
-- 管理画面（src/app/admin/photos/page.tsx）は photos バケットへ
--   facilities/<facility_id>/<時刻>-<番号>.<拡張子>
-- でアップロードし、getPublicUrl の結果（https://<host>/storage/v1/object/public/photos/facilities/...）を
-- 保存するので、この形式だけを許す。ホスト名は環境ごとに違う（ローカル・CI の Supabase は http://127.0.0.1:54321）ため SQL では固定せずパス部分を固定する。
--
-- ・既存行は削除も変更もしない（このファイルはポリシーと判定関数だけを置き換える）。
-- ・service_role（API・掲載申込から店舗を作る setup_facility_from_registration 等）は RLS を通らないため影響しない。
-- ・ブラウザからの UPDATE はアプリに無い（削除は /api/admin/photos/[id] の RPC）。外部 URL の既存行を
--   ブラウザから直接書き換えようとすると WITH CHECK で拒否される＝外部 URL の付け替えもできなくなる。
-- ・判定は先頭一致だけでなく、施設 ID の一致・「..」「?」「#」「\」の不在まで見る。
--
-- 適用順序：コードの変更を伴わないので単独で適用してよい。
-- 適用前の確認（SQL Editor・SELECT のみ・結果は参考。既存行はこの migration で変わらない）:
--   SELECT count(*) FILTER (WHERE NOT public.facility_photo_url_is_own_storage(photo_url, facility_id))
--     FROM public.facility_photos;   -- ※関数作成後に実行
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
  IF to_regclass('public.facility_photos') IS NULL THEN RAISE EXCEPTION 'facility_photos is missing'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.facility_photo_url_is_own_storage(p_url text, p_facility_id uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p_url IS NOT NULL AND p_facility_id IS NOT NULL
    AND strpos(p_url, '..') = 0 AND strpos(p_url, chr(92)) = 0
    AND p_url !~ '[?#[:space:]]'
    AND p_url ~ ('^https?://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/photos/facilities/'
                 || p_facility_id::text || '/[^/]+$');
$$;
REVOKE ALL ON FUNCTION public.facility_photo_url_is_own_storage(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_photo_url_is_own_storage(text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "owner_admin_insert_photos" ON public.facility_photos;
CREATE POLICY "owner_admin_insert_photos" ON public.facility_photos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.facility_members m
      WHERE m.facility_id = facility_photos.facility_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY (ARRAY['owner'::text, 'admin'::text]))
    AND public.facility_photo_url_is_own_storage(photo_url, facility_id)
  );

DROP POLICY IF EXISTS "owner_admin_update_photos" ON public.facility_photos;
CREATE POLICY "owner_admin_update_photos" ON public.facility_photos
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.facility_members m
      WHERE m.facility_id = facility_photos.facility_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY (ARRAY['owner'::text, 'admin'::text]))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.facility_members m
      WHERE m.facility_id = facility_photos.facility_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY (ARRAY['owner'::text, 'admin'::text]))
    AND public.facility_photo_url_is_own_storage(photo_url, facility_id)
  );
