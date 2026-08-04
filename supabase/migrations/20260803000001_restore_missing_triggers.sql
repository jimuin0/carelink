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
-- 本番に適用されていなかったトリガ 2 本を復旧する（2026年8月3日）
-- ============================================================================
-- 🔴 どうやって見つけたか:
--   新設したスキーマ・フィンガープリント監視の初回突合で、
--   「migration にはあるのに本番に無い」トリガが 2 本あることを実測した
--   （本番 trigger 13 本 / migration 由来 15 本）。
--   旧監視は pg_constraint の contype IN ('p','u') しか見ていなかったため、
--   トリガの欠落は **構造的に検知不能** だった。
--
-- 実測（2026年8月3日・本番 xzafxiupbflvgbarrihe）:
--   trg_review_verified_visit    … 無い
--   fn_set_review_verified_visit … 無い（＝トリガが消えたのではなく migration ごと未適用）
--   trg_area_seo_updated_at      … 無い
--   facility_reviews の CHECK 制約 2 本（20260729000002）… ある
--   ＝ 特定の migration だけが本番に飛んでいる状態だった。
--
-- 実害の有無（実測）: facility_reviews は 0 行。裏付けの無い「来店確認済み」も 0 件。
--   よって現時点の被害は無く、これは「防御層が 1 枚欠けたまま運用に入る手前で塞ぐ」修正。
--
-- ⚠️ なぜ 20260417000037 を編集せず新しい migration にするか:
--   古い migration を書き換えると、既に適用済みの環境と shadow で結果が食い違う。
--   CREATE OR REPLACE を後から重ねれば、shadow（全 migration 適用）でも
--   本番（この 1 本だけ適用）でも最終状態が一致する。

-- ── 1. 来店確認バッジの DB 側強制 ──────────────────────────────────────────
-- why: クライアントが送ってきた is_verified_visit を信用せず、completed 予約の
--   実在を DB 側で確認して**上書き**する。
--   CHECK 制約（facility_reviews_verified_visit_requires_user）は「匿名なのに
--   来店確認済み」しか止められない。「ログイン済みだが来店実績が無いのに
--   来店確認済み」を止められるのはこのトリガだけ＝両者は代替関係ではない。
-- when: /api/review を通らない投入（service_role スクリプト・SQL Editor・将来の別経路）
--   でも必ず正しい値に矯正される。2026年7月29日に実際に起きた
--   「サイト経由でない口コミ 13 件・うち 3 件が裏付け無しの来店確認済みバッジ」の再発防止。
--
-- 🔴 SET search_path = '' を追加した（原本 20260417000037 には無かった）。
--   SECURITY DEFINER 関数が search_path を固定していないと、検索パス上に細工した
--   bookings を置かれた場合に定義者権限で誤ったテーブルを参照し得る。
--   CareLink の CI（Reject newly-added SECURITY DEFINER without SET search_path）が
--   新規コードに対して禁じている形そのもの。**本番にまだ存在しない今なら、
--   弱点を持ち込まずに入れられる**ので、復旧と同時に直す。
--   search_path が空になるため、テーブル参照は public. で明示修飾する。
CREATE OR REPLACE FUNCTION public.fn_set_review_verified_visit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- user_id がある場合のみ来店確認チェック（匿名レビューは false のまま）
  IF NEW.user_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1
      FROM public.bookings
      WHERE facility_id = NEW.facility_id
        AND user_id = NEW.user_id
        AND status = 'completed'
    ) INTO NEW.is_verified_visit;
  ELSE
    NEW.is_verified_visit := FALSE;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_review_verified_visit ON public.facility_reviews;
CREATE TRIGGER trg_review_verified_visit
  BEFORE INSERT ON public.facility_reviews
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_review_verified_visit();

-- ── 2. area_seo_contents.updated_at の自動更新 ─────────────────────────────
-- why: 更新時刻が止まると「いつ更新されたか」を根拠にした判断が全て狂う。
--   SECURITY DEFINER ではなく NEW と NOW() しか触らないので、こちらは原本のまま。
CREATE OR REPLACE FUNCTION public.update_area_seo_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_area_seo_updated_at ON public.area_seo_contents;
CREATE TRIGGER trg_area_seo_updated_at
  BEFORE UPDATE ON public.area_seo_contents
  FOR EACH ROW EXECUTE FUNCTION public.update_area_seo_updated_at();
