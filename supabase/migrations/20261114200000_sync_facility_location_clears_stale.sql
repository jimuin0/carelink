-- 点検 A408（2026年11月14日）：座標を消しても古い location が残る不具合を直す。
--
-- sync_facility_location は latitude / longitude が両方とも非 NULL のときだけ location を書き換えていた。
-- 座標を NULL に戻しても location は古いまま残り、search_facilities_nearby（fp.location IS NOT NULL だけを見る）が
-- 座標の無い施設を古い位置で返していた。どちらかが NULL なら location も NULL にする。
-- 写し元: 20260602000011（本文）＋ 20261015140541（search_path の固定）。CREATE OR REPLACE は設定も置き換えるので SET を書く。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.sync_facility_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.location = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  ELSE
    NEW.location = NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- 既に取り残されている行を一度だけ是正する（座標が欠けているのに location がある行だけ。冪等）。
UPDATE public.facility_profiles
SET location = NULL
WHERE location IS NOT NULL AND (latitude IS NULL OR longitude IS NULL);
