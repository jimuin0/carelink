-- 予約即時確定モード（v8.14）
-- 施設ごとに予約を自動確定するか手動承認するかを選択可能にする

ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS booking_auto_confirm BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN facility_profiles.booking_auto_confirm IS
  'true: 予約を即時confirmed / false: pending状態で手動承認待ち';
