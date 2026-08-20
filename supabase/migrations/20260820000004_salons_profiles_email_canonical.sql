-- ============================================================================
-- 🔴 接続先ガード（誤ったプロジェクトへ適用したら何も作らずに落ちる）
-- ============================================================================
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION
      'このデータベースは CareLink ではありません（public.facility_profiles が存在しない）。'
      ' 接続先プロジェクトを確認してください。CareLink の本番 ref は xzafxiupbflvgbarrihe です。';
  END IF;
END
$guard$;

-- ============================================================================
-- salons.email_canonical / profiles.email_canonical を新設する（2026年8月20日）
-- ============================================================================
-- 【なぜこの列が要るか（実コードで確定した無音失敗）】
--   /register の入力を /admin/onboarding が管理画面へ引き継ぐキーは、
--   salons.email と auth.users のメール（Supabase Auth 経由・SSR で読む user.email）の
--   【バイト完全一致】だけ（src/app/api/facility/setup/route.ts の
--   `.eq('email', user.email)`）。onboarding-followup cron の「アカウント作成済みか」判定
--   （src/app/api/cron/onboarding-followup/route.ts の `.eq('email', salon.email)` で
--   profiles と突合）も同じバイト完全一致。
--
--   両側とも正規化が無いため、以下で無音に壊れる:
--     - 大文字小文字: salons.email は text・COLLATE 指定なし・citext 不使用。
--       zod は .toLowerCase() を掛けていない（src/app/api/salons/route.ts）。.eq() はバイト比較。
--     - gmail のプラス・ドット: foo+tag@gmail.com と foo@gmail.com は Gmail では同一受信箱だが
--       別文字列として保存される。
--
--   引き継ぎ側（facility/setup）の実害: register で入力した営業時間・写真・特徴・PR・
--   prefecture/city 等が引き継がれず、オーナーが管理画面で全て入力し直しになる
--   （「せっかく register で入力したのに何も引き継がれない」という無音の劣化）。
--   cron 側（onboarding-followup）の実害はより深刻な fail-open: 大文字小文字・+tag/ドット
--   違いで既存アカウントを見つけられないと existingProfile=null → else 枝に落ち、
--   【既にアカウントを持つ店舗へ「まだ作られていません」と誤送信する】。
--
--   このリポジトリは同種の問題を bookings / customer_visits の予約客突合では既に
--   email_canonical 生成列（20260607_email_canonical_column.sql）で解決済みで、
--   src/lib/email-canonical.ts の canonicalizeEmail() が正規化ロジックの単一ソース
--   （+tag 除去・ドット除去・googlemail→gmail 統一・非 gmail は小文字化のみ）。
--   【予約客には適用されている正規化が、掲載店舗の引き継ぎ・突合には適用されていなかった】
--   ため、同じ形で salons と profiles にも generated column を足す。
--
-- 生成式は 20260607_email_canonical_column.sql の bookings.email_canonical /
-- customer_visits.email_canonical と完全に同一（別式にすると同じ入力から違う値が
-- 出てしまい、予約客突合と店舗突合で「同一人物」の定義がずれる）。
-- 生成式は canonicalizeEmail() と同一出力:
--   gmail.com/googlemail.com のみ: ローカル部の "+tag" 以降除去・ドット除去・
--   ドメインを gmail.com に統一（除去後にローカル部が空になる不正値は小文字化のみ）
--   非 gmail: 小文字化(+trim)のみ
--
-- GENERATED ALWAYS AS ... STORED は IMMUTABLE 関数(lower/btrim/split_part/regexp_replace)
-- のみで構成。列追加時に既存行も自動算出されるため別途 backfill 不要。
-- 直接 INSERT/UPDATE できずドリフトしない（DBが一貫性保証）。
-- 冪等化のため存在チェックして追加する。

-- salons.email_canonical（salons.email は NOT NULL だが、既存 migration の形式
-- （bookings/customer_visits）と完全一致させるため NULL 分岐も残す＝防御的に同じ形）
ALTER TABLE salons
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

-- facility/setup の salons 突合 .eq('email_canonical', canonicalizeEmail(user.email)) 用インデックス
CREATE INDEX IF NOT EXISTS idx_salons_email_canonical
  ON salons(email_canonical);

-- profiles.email_canonical（profiles.email は NULL 許容＝ソーシャルログイン等でメール未取得の
-- 行があり得るため、CASE の NULL 分岐が実際に効く）
ALTER TABLE profiles
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

-- onboarding-followup cron の profiles 突合 .eq('email_canonical', canonicalizeEmail(salon.email))
-- 用インデックス（「アカウント作成済みか」判定を毎 run 走らせるため）
CREATE INDEX IF NOT EXISTS idx_profiles_email_canonical
  ON profiles(email_canonical);
