-- 同一人物突合用の canonical メール列（#Gmail正規化・email_canonical 列方式）。
--
-- 方針: email/customer_email は「原文（小文字化）」のまま送信・表示に使い（Gmail の "+tag" 等の届け先を尊重）、
-- 同一人物の突合（new_customer/repeat 履歴照合・RFM 集計）は本 GENERATED 列で行う。
-- 生成式は src/lib/email-canonical.ts canonicalizeEmail と同一出力:
--   gmail.com/googlemail.com のみ: ローカル部の "+tag" 以降除去・ドット除去・ドメインを gmail.com に統一
--   （除去後にローカル部が空になる不正値は小文字化のみ）／非 gmail: 小文字化(+trim)のみ
--
-- GENERATED ALWAYS AS ... STORED は IMMUTABLE 関数(lower/btrim/split_part/regexp_replace)のみで構成。
-- 列追加時に既存行も自動算出されるため別途 backfill 不要。直接 INSERT/UPDATE できずドリフトしない（DBが一貫性保証）。
-- 冪等化のため存在チェックして追加する。

-- bookings.email_canonical
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS email_canonical TEXT
  GENERATED ALWAYS AS (
    CASE
      WHEN email IS NULL THEN NULL
      WHEN lower(split_part(email, '@', 2)) IN ('gmail.com', 'googlemail.com')
       AND length(regexp_replace(split_part(split_part(lower(btrim(email)), '@', 1), '+', 1), '\.', '', 'g')) > 0
      THEN regexp_replace(split_part(split_part(lower(btrim(email)), '@', 1), '+', 1), '\.', '', 'g') || '@gmail.com'
      ELSE lower(btrim(email))
    END
  ) STORED;

-- 履歴照合 .eq('facility_id').eq('email_canonical') 用の複合インデックス
CREATE INDEX IF NOT EXISTS idx_bookings_facility_email_canonical
  ON bookings(facility_id, email_canonical);

-- customer_visits.email_canonical（管理台帳 RFM の顧客識別キー・lib/admin.ts）
ALTER TABLE customer_visits
  ADD COLUMN IF NOT EXISTS email_canonical TEXT
  GENERATED ALWAYS AS (
    CASE
      WHEN customer_email IS NULL THEN NULL
      WHEN lower(split_part(customer_email, '@', 2)) IN ('gmail.com', 'googlemail.com')
       AND length(regexp_replace(split_part(split_part(lower(btrim(customer_email)), '@', 1), '+', 1), '\.', '', 'g')) > 0
      THEN regexp_replace(split_part(split_part(lower(btrim(customer_email)), '@', 1), '+', 1), '\.', '', 'g') || '@gmail.com'
      ELSE lower(btrim(customer_email))
    END
  ) STORED;
