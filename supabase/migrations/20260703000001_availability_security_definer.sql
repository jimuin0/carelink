-- AV-1 根治: 空き枠算出関数を SECURITY DEFINER 化して RLS 越しでも全予約を見て競合判定する。
--
-- 背景（事実）:
--   get_available_slots / get_month_availability は既定(SECURITY INVOKER)で作られており、
--   /api/slots・/api/availability は anon キー(createServerSupabaseClient)で呼ぶ。
--   bookings の RLS SELECT は本人(auth.uid()=user_id)または施設メンバーのみ許可のため、
--   匿名客・別客から呼ぶと関数内の bookings 参照が0件に見え、競合判定が素通り
--   → 実際は埋まっている枠が「空き」として表示される（予約少数の今は潜在化、実客投入で発症）。
--
-- 対策: 関数を SECURITY DEFINER + search_path=public に変更し、所有者権限で bookings 全件を
--   読んで正しく競合判定させる。関数は slot 時刻のみ返し予約者情報は返さないため PII 露出は無い。
--   本体は不変（ALTER のみ）で退行リスクを最小化。冪等（何度実行しても同じ）。

ALTER FUNCTION get_available_slots(uuid, uuid, date, integer) SECURITY DEFINER;
ALTER FUNCTION get_available_slots(uuid, uuid, date, integer) SET search_path = public;

ALTER FUNCTION get_month_availability(uuid, uuid[], integer, integer, integer) SECURITY DEFINER;
ALTER FUNCTION get_month_availability(uuid, uuid[], integer, integer, integer) SET search_path = public;
