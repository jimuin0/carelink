-- 誕生日通知の送達記録テーブル（birthday-coupon cron 再送対策）
-- ポイント付与済みでも通知チャネルごとの送達を独立追跡し、
-- 失敗チャネルを翌 run で再送できるようにする。
CREATE TABLE IF NOT EXISTS birthday_notifications (
  user_id    uuid      NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  year       int       NOT NULL,
  notified_at timestamptz NOT NULL DEFAULT now(),
  channel    text      NOT NULL CHECK (channel IN ('email', 'line')),
  PRIMARY KEY (user_id, year, channel)
);
ALTER TABLE birthday_notifications ENABLE ROW LEVEL SECURITY;
-- service_role のみアクセス可（cron 専用）。anon/authenticated ポリシーは作らない。
