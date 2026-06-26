-- 同一予約に有効な pending 決済セッションを1件までに強制する部分 UNIQUE インデックス。
--
-- 背景(事実): /api/payment/checkout は未払い予約に対して呼ぶたびに stripe_sessions(pending) を
--   新規 INSERT していたため、同一 booking_id に複数の pending セッションが並存し、両方を完了
--   すると二重課金になり得た。アプリ側(PR)で「新規作成前に既存 pending を expire」する逐次
--   ガードを入れたが、同時2リクエストの競合は DB 制約でしか完全には防げない。
-- 本インデックスにより、status='pending' の行は booking_id ごとに最大1件に強制される（競合時は
--   2件目の INSERT が一意制約違反で失敗 → アプリは既存の insert 失敗経路で安全に処理）。
--
-- 既存データに重複 pending が残っていると CREATE INDEX が失敗するため、最新1件を残して
-- 他を expired 化してからインデックスを作成する（冪等・安全）。
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY booking_id ORDER BY created_at DESC) AS rn
  FROM public.stripe_sessions
  WHERE status = 'pending' AND booking_id IS NOT NULL
)
UPDATE public.stripe_sessions s
SET status = 'expired'
FROM ranked r
WHERE s.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_sessions_booking_pending
  ON public.stripe_sessions (booking_id)
  WHERE status = 'pending' AND booking_id IS NOT NULL;
