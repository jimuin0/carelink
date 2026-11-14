-- 駅名の候補を、公開施設の最寄り駅から重複を除いて返す（点検 B3-4・2026年11月14日）。
--
-- 【それまでの状態】/api/stations は facility_profiles.nearest_station を DISTINCT なしで
-- limit 200 件読み、アプリ側で重複を除いていた。同じ駅の施設が多いと 200 行の大半が同じ駅名で
-- 埋まり、他の駅が候補から欠けた。
--
-- 【この migration で入れるもの】
--   list_published_stations(p_query) … 公開施設（status='published'）の最寄り駅を
--   重複なし・五十音順（照合順）で最大 200 件返す。p_query は部分一致（50 文字まで・% _ \ はエスケープ）。
--   返すのは駅名だけで、施設の他の列は返さない。facility_profiles の権限には依存させず
--   SECURITY DEFINER（search_path=''）で公開行だけを読む。EXECUTE は anon のみ
--   （/api/stations は anon キーのサーバークライアントで呼ぶ）。
--
-- 【本番の適用順序】この migration を適用 → コードをデプロイ。
--   関数を足すだけなので旧コードには影響しない。コードを先に出すと駅候補が 500 になる。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

CREATE OR REPLACE FUNCTION public.list_published_stations(p_query text DEFAULT NULL)
RETURNS TABLE(nearest_station text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT DISTINCT fp.nearest_station
  FROM public.facility_profiles fp
  WHERE fp.status = 'published'
    AND fp.nearest_station IS NOT NULL
    AND btrim(fp.nearest_station) <> ''
    AND (
      p_query IS NULL OR btrim(p_query) = ''
      OR fp.nearest_station ILIKE '%' || replace(replace(replace(left(btrim(p_query), 50), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
  ORDER BY fp.nearest_station
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.list_published_stations(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_published_stations(text) TO anon;
