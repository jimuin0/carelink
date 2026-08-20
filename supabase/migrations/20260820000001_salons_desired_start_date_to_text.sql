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
-- salons.desired_start_date を date → text に変更する（2026年8月20日）
-- ============================================================================
-- 🔴 何が壊れていたか（実測・PG16 の使い捨てDBで再現確認済み）:
--   /register（フォーム）の「掲載希望時期」は列挙文字列
--     '' | 'immediately' | 'within_1month' | 'within_3months' | 'undecided'
--   をそのまま送信するが、salons.desired_start_date は date 型だったため、
--   4つの選択肢すべてで INSERT が
--     ERROR: 22007 invalid input syntax for type date: "immediately"
--   になり 500 で失敗していた（未選択のときだけ成功する）。
--   経路上（route.ts → salons テーブル）に列挙値→日付への変換は一切存在しない。
--
-- なぜ「日付に変換する」ではなく「列を text にする」か:
--   「すぐに掲載したい／1ヶ月以内／3ヶ月以内／検討中」はそもそも暦日ではなく意向を表す
--   区分値であり、date 列に入れる設計自体が誤りだった。'undecided'（検討中）を表現できる
--   日付は存在しないため、日付へ変換する方針は情報の欠落を伴う。列挙値を列挙値のまま
--   保存するのが実態に合った直し方（指示書 docs/register-blocker-instructions.md §3 P0-1 方針A）。
--
-- 安全性:
--   本番の desired_start_date は全4値で INSERT が例外落ちしていたため、この列に
--   実際に値が保存されている行は無い想定（未選択＝NULL の行のみ）。移行前に
--   `select desired_start_date, count(*) from salons group by 1;` で全て NULL/空文字
--   であることを確認してから適用すること（指示書 §3 P0-1 手順1）。
--   USING句は date→text の単純キャストなので、万一 NULL 以外の値（正規の日付文字列）が
--   入っていた場合も 'YYYY-MM-DD' 形式の text としてそのまま保持され、データは失われない。
ALTER TABLE public.salons
  ALTER COLUMN desired_start_date TYPE text USING desired_start_date::text;
