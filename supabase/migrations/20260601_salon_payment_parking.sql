-- サロン掲載情報：支払い方法「その他」自由記述 / 駐車場 自由記述
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS payment_other TEXT,  -- 支払い方法「その他」（PayPay 等）
  ADD COLUMN IF NOT EXISTS parking_text  TEXT;  -- 駐車場（提携駐車場あり 等）
