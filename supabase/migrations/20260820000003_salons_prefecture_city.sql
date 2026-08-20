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
-- salons.prefecture / salons.city を新設する（2026年8月20日）
-- ============================================================================
-- 【なぜこの列が要るか（実データで確定）】
--   facility_profiles.prefecture は /search の地域絞り込み（src/lib/facilities.ts:59 の
--   .eq('prefecture', …)）と「近くの施設」「似ている施設」の結合キーだが、セルフサーブ経路
--   （/register → /auth/signup → /admin/onboarding → /api/facility/setup）では【構造的に
--   必ず null】になっていた。理由の1つが salons に prefecture / city 列が無いこと。
--
--   /register は郵便番号から zipcloud を引いて address1（都道府県）・address2（市区町村）・
--   address3 を受け取っているのに、連結して 1 本の text（salons.address）にした時点で
--   構造を捨てていた。以後は address1/address2 をそのまま保持し、DB 側にも構造化した列を
--   用意する（自由文の address からの復元は src/lib/japan-address.ts の
--   extractPrefecture/extractCity・郵便番号未入力や zipcloud 障害時のフォールバック用）。
--
-- 安全性:
--   ADD COLUMN IF NOT EXISTS・NOT NULL 制約なし・DEFAULT なし（NULL=未取得の自然な初期値）
--   なので、既存行への影響はゼロ（既存の 8 件は全行 NULL で始まる。復元は本 migration の
--   責務ではなく、後続の運用でバックフィルする）。
ALTER TABLE public.salons
  ADD COLUMN IF NOT EXISTS prefecture text,
  ADD COLUMN IF NOT EXISTS city text;
