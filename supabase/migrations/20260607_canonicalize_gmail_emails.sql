-- Gmail/googlemail の既存メールを canonical 化（#Gmail正規化・new_customer クーポン金銭バグの真の予防の既存データ是正）。
--
-- アプリ側は bookingSchema で email を canonicalizeEmail（gmail のドット除去・"+tag"除去・googlemail→gmail）
-- 済み。既存行が生のままだと、同一人物の旧予約(foo+x@gmail)と新予約(canonical foo@gmail)が突合せず
-- 「別客＝新規」と誤判定され続ける。既存 gmail/googlemail 行も同じ規則で揃える。
--
-- 規則（canonicalizeEmail と一致）: ローカル部 = lower(local) の "+"以降除去 + ドット除去、ドメイン = gmail.com。
-- 非 gmail/googlemail は対象外（プロバイダ依存のため別人を誤併合しない）。ローカル部が空になる不正値は除外。
-- 冪等（再実行しても DISTINCT ガードで no-op）・gmail 行のみ・非破壊（配信先は同一受信箱）。

-- bookings.email
UPDATE bookings b
SET email = regexp_replace(split_part(split_part(lower(btrim(b.email)), '@', 1), '+', 1), '\.', '', 'g') || '@gmail.com'
WHERE b.email IS NOT NULL
  AND lower(split_part(b.email, '@', 2)) IN ('gmail.com', 'googlemail.com')
  AND length(regexp_replace(split_part(split_part(lower(btrim(b.email)), '@', 1), '+', 1), '\.', '', 'g')) > 0
  AND b.email IS DISTINCT FROM (regexp_replace(split_part(split_part(lower(btrim(b.email)), '@', 1), '+', 1), '\.', '', 'g') || '@gmail.com');

-- customer_visits.customer_email（管理台帳 RFM の顧客識別キー・lib/admin.ts）も同規則で揃える
UPDATE customer_visits cv
SET customer_email = regexp_replace(split_part(split_part(lower(btrim(cv.customer_email)), '@', 1), '+', 1), '\.', '', 'g') || '@gmail.com'
WHERE cv.customer_email IS NOT NULL
  AND lower(split_part(cv.customer_email, '@', 2)) IN ('gmail.com', 'googlemail.com')
  AND length(regexp_replace(split_part(split_part(lower(btrim(cv.customer_email)), '@', 1), '+', 1), '\.', '', 'g')) > 0
  AND cv.customer_email IS DISTINCT FROM (regexp_replace(split_part(split_part(lower(btrim(cv.customer_email)), '@', 1), '+', 1), '\.', '', 'g') || '@gmail.com');
