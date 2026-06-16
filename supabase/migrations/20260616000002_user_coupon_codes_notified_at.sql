-- user_coupon_codes に通知送達タイムスタンプ列を追加（customer-segment cron 再送対策）
-- クーポン作成済みでもメール送信失敗の場合、notified_at IS NULL で翌 run が再送できるようにする。
ALTER TABLE user_coupon_codes ADD COLUMN IF NOT EXISTS notified_at timestamptz;
