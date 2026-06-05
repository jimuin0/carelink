-- 予約 email の正規化是正（round6・入力正規化の非対称を解消）
--
-- 背景: bookings.email は保存時に正規化されず生のまま入っていた一方、突合側は lower(email) を使うため、
--   同一人物が大文字小文字違いで「別人扱い」になり、クーポン new_customer/repeat の二重取得・誤拒否、
--   顧客集計の分裂、管理の属性突合漏れ（profiles.email は Auth 由来で小文字）を起こしていた。
--   アプリ側は bookingSchema で email を小文字＋trim 正規化するよう是正済み。既存行も揃える。
--
-- email はRFC上ローカル部が大小区別され得るが、実運用の全主要プロバイダは大小無視のため小文字化は安全。
UPDATE bookings
SET email = lower(btrim(email))
WHERE email IS NOT NULL
  AND email IS DISTINCT FROM lower(btrim(email));

-- 顧客名も前後空白を除去（表記ゆれによる顧客分裂を抑制）
UPDATE bookings
SET customer_name = btrim(customer_name)
WHERE customer_name IS NOT NULL
  AND customer_name IS DISTINCT FROM btrim(customer_name);
