-- 電話・来店受付の予約（メール無し）を顧客管理に出す（2026年10月23日）。
--
-- 【症状】/admin/board から電話予約をメール欄空欄で作り「完了」にすると、来店記録
--   （customer_visits）は customer_email=NULL で残る。ところが顧客一覧の集計
--   get_unique_customers は「メールが無い来店」を丸ごと除いていたため、
--     - その来店は「来店履歴から未登録のお客様」に 1 行も出ない
--     - 電話番号だけで台帳に登録したお客様は来店 0 回・最終来店「—」・詳細は「来店履歴がありません」
--   のままだった。
--
-- 【直し方】メールが無い来店は、予約（bookings.phone）の電話番号で同じ人かを判定する。
--   突合キーは「メールがあれば email_canonical、無ければ 'tel:' ＋ 電話番号の数字だけ」。
--   アプリ側の src/lib/customer-identity.ts（customerIdentityKey / phoneDigits）と同じ規則:
--     - 全角数字は半角にし、数字以外（ハイフン・空白・括弧）は捨てる
--     - 10 桁未満は識別に使わない（「0」「1234」のような仮の入力で別の人をまとめない）
--     - メールがある来店は電話番号では突合しない（家族で 1 つの電話番号を使う場合に混ぜない）
--     - メールも電話番号も無い来店は今までどおり除く（名前だけで別の人をまとめない）
--
--   1. customer_phone_digits(text)        電話番号 → 数字だけ（10 桁未満は NULL）
--   2. get_customer_visit_summary(uuid)    顧客一覧の集計（get_unique_customers の電話対応版）
--   3. get_customer_phone_visits(uuid,text) 電話番号で登録したお客様の来店履歴（顧客詳細）
--
--   どれも SECURITY INVOKER。customer_visits（owner/admin だけが読める）と bookings の RLS が
--   そのまま効くので、施設の owner/admin 以外には 1 行も返らない。
--
-- 【既存の get_unique_customers は変えない】戻り値の列（phone）を足すには DROP が要り、
--   適用からアプリのデプロイまでの間、動いているアプリの集計が壊れる。新しい関数を足すだけにして、
--   旧アプリは旧関数を使い続けられるようにした。新しいアプリは旧関数を呼ばない（後日撤去してよい）。
--
-- 【デプロイ順】アプリより先に適用してよい（関数を足すだけ・既存の関数・表・権限は変えない）。
--   新しいアプリが先に出ても、関数が無いあいだは来店記録を直接読む予備の経路で同じ結果を出す。
--   関数・権限の行は src/lib/schema-fingerprint.expected.json にも入る（PostgreSQL 17 の shadow で
--   再生成が要る）。schema-drift-check はデプロイ済みアプリの期待値と比べるので、適用からデプロイまでの
--   間に JST 02:40 を跨ぐとその回だけ差分として報告される。適用とデプロイは同じ日のうちに続けて行う。
--
-- 実 DB での検証は supabase/shadow/customer-phone-identity-fixtures.sql。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

CREATE OR REPLACE FUNCTION public.customer_phone_digits(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE WHEN length(d) >= 10 THEN d END
  FROM (SELECT regexp_replace(translate(coalesce(p_phone, ''), '０１２３４５６７８９', '0123456789'), '[^0-9]', '', 'g') AS d) s;
$$;
REVOKE ALL ON FUNCTION public.customer_phone_digits(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_phone_digits(text) TO authenticated, service_role;

-- 1 行 = 1 人。email / phone / name は最も新しい来店のもの（表示と「＋登録」の下書き用）。
-- 並びは最終来店の新しい順。ページング（.range）で行が重複・欠落しないよう、同じ日付はキーで並べる。
CREATE OR REPLACE FUNCTION public.get_customer_visit_summary(p_facility_id uuid)
RETURNS TABLE(email text, phone text, name text, visit_count bigint, last_visit date)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  WITH keyed AS (
    SELECT v.id, v.visit_date, v.customer_name,
      nullif(btrim(v.customer_email), '') AS visit_email,
      b.phone AS booking_phone,
      COALESCE(nullif(btrim(v.email_canonical), ''), 'tel:' || public.customer_phone_digits(b.phone)) AS customer_key
    FROM public.customer_visits v
    LEFT JOIN public.bookings b ON b.id = v.booking_id AND b.facility_id = v.facility_id
    WHERE v.facility_id = p_facility_id
  ), ranked AS (
    SELECT customer_key, visit_email, booking_phone, customer_name,
      row_number() OVER (PARTITION BY customer_key ORDER BY visit_date DESC, id) AS rn,
      count(*) OVER (PARTITION BY customer_key) AS cnt,
      max(visit_date) OVER (PARTITION BY customer_key) AS maxd
    FROM keyed WHERE customer_key IS NOT NULL
  )
  SELECT visit_email, booking_phone, customer_name, cnt, maxd
  FROM ranked WHERE rn = 1
  ORDER BY maxd DESC, customer_key;
$$;
REVOKE ALL ON FUNCTION public.get_customer_visit_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_visit_summary(uuid) TO authenticated, service_role;

-- メールの無い来店のうち、予約の電話番号が一致するもの。電話番号が識別に使えない（空・10 桁未満）
-- ときは 1 行も返さない（施設の全来店を返さない）。
CREATE OR REPLACE FUNCTION public.get_customer_phone_visits(p_facility_id uuid, p_phone text)
RETURNS SETOF public.customer_visits
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT v.*
  FROM public.customer_visits v
  JOIN public.bookings b ON b.id = v.booking_id AND b.facility_id = v.facility_id
  WHERE v.facility_id = p_facility_id
    AND nullif(btrim(v.email_canonical), '') IS NULL
    AND public.customer_phone_digits(b.phone) = public.customer_phone_digits(p_phone)
  ORDER BY v.visit_date DESC, v.id;
$$;
REVOKE ALL ON FUNCTION public.get_customer_phone_visits(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_phone_visits(uuid, text) TO authenticated, service_role;
