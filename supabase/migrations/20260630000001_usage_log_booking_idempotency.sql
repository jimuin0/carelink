-- 回数券・サブスクの「二重消費」をDBレベルで物理的に不能化する多層防御（部分UNIQUE）。
--
-- 背景：スタッフが「1回使用」を連打/リトライすると、同一 booking_id に対してセッションが
-- 複数回減算され、顧客が前払いした回数券・サブスク当月枠を二重に失う不具合があった。
-- アプリ側（route）で booking_id 単位の事前チェック＋CAS により逐次・並行の二重消費を防いだ上で、
-- 万一のロジック欠落・真の同時挿入に対する最終防壁として同一 booking_id の重複ログを禁止する。
--
-- booking_id が NULL（管理画面からの手動消費＝予約に紐づかない）は冪等キーが無いため対象外
-- （部分インデックスの WHERE で除外）。

CREATE UNIQUE INDEX IF NOT EXISTS uq_package_usage_logs_booking
  ON package_usage_logs (user_package_id, booking_id)
  WHERE booking_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_usage_logs_booking
  ON subscription_usage_logs (subscription_id, booking_id)
  WHERE booking_id IS NOT NULL;
