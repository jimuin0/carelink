-- 20260613000001_month_availability_rpc.sql
-- T7: 公開予約カレンダーの可用性取得 N+1 解消（発症前予防・恒久根本解決）
--
-- 【背景・根本原因（事実）】
--   src/app/api/availability/route.ts は、月の未来日（最大 ~31 日）× 施設スタッフ（最大 10 名）
--   の組合せで get_available_slots を個別 RPC 呼び出ししていた（最悪 ~310 ラウンドトリップ）。
--   公開導線（施設ページ／予約カレンダー）であり、スタッフ数・日数が増えるほど線形に悪化する。
--
-- 【対策】
--   月×全スタッフのスロット数を 1 回の RPC で集計する集約関数を新設し、API 側を 1 ラウンド
--   トリップ化する。スロット生成・予約競合・バッファタイムのロジックは既存の
--   get_available_slots（20260417000006_booking_buffer.sql のバッファ対応版・SECURITY INVOKER）
--   を内部から LATERAL 呼び出しすることで一切複製しない（ロジック・ドリフト防止）。
--
-- 【セキュリティ】
--   SECURITY INVOKER（既定）。get_available_slots と同じ呼び出し権限・RLS 文脈で動作する。
--   search_path は L6 規約（20260603000001）に合わせて固定。anon/authenticated に EXECUTE 付与
--   （availability route は anon クライアントで呼ぶため）。

CREATE OR REPLACE FUNCTION get_month_availability(
  p_facility_id UUID,
  p_staff_ids UUID[],
  p_year INT,
  p_month INT,
  p_duration_minutes INT
)
RETURNS TABLE(d DATE, slots INT)
LANGUAGE sql
-- get_available_slots は plpgsql 既定 VOLATILE のため、ラッパーも既定 VOLATILE のままにする
-- （STABLE と誤ラベルしてプランナの前提をずらさない）。本関数はリクエストごとに 1 回呼ばれるのみ。
SET search_path = public, extensions, pg_temp
AS $$
  SELECT
    gs.day::date AS d,
    COALESCE((
      SELECT COUNT(*)
      FROM unnest(p_staff_ids) AS s(sid)
      CROSS JOIN LATERAL get_available_slots(p_facility_id, s.sid, gs.day::date, p_duration_minutes) AS slot
    ), 0)::int AS slots
  FROM generate_series(
    make_date(p_year, p_month, 1)::timestamp,
    (make_date(p_year, p_month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::timestamp,
    INTERVAL '1 day'
  ) AS gs(day);
$$;

GRANT EXECUTE ON FUNCTION get_month_availability(UUID, UUID[], INT, INT, INT) TO anon, authenticated;
