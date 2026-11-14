-- 時間調整依頼の LINE 送信を操作 ID で 1 回に限る（点検 A119・2026年11月14日）。
--
-- 【それまでの状態】/api/admin/booking-adjust-request のメール経路は operationId と
-- booking_adjust_operations で冪等だったが、LINE 経路は押すたびに sendLineText を呼んでいた。
-- 二重クリックや応答を失った後の再送で、同じ依頼がお客様の LINE に 2 通届いた。
--
-- 【この migration で入れるもの】
--   booking_adjust_line_operations（操作 ID → 操作者・予約）。API は LINE を送る【前】に
--   この表へ操作 ID を INSERT し、主キー違反（同じ操作 ID の 2 回目）なら送らずに受付済みを返す。
--   送信失敗分は webhook_retry_queue が自動再送するので、行は消さない（消すと手動再送と二重になる）。
--   読み書きは service_role だけ（ブラウザには一切の権限を与えない）。
--
-- 【本番の適用順序】この migration を適用 → コードをデプロイ。
--   新しい表を足すだけなので旧コードには影響しない。コードを先に出すと LINE 送信が 500 になる。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

CREATE TABLE public.booking_adjust_line_operations (
  operation_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.booking_adjust_line_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_adjust_line_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.booking_adjust_line_operations TO service_role;
