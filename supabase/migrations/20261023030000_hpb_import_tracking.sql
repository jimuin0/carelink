DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

-- HPB メニュー取り込み（/admin/hpb-menus）に「HPB から無くなった」と「お客様メニューへ反映した」を
-- 記録する列を足す（2026年10月23日）。
--
-- 【不具合】
--   1. HPB で掲載が終わったクーポン・メニューや、誤った店舗IDで取得した別の店舗の行が
--      hpb_menu_durations に残り続け、「お客様メニューへ一括反映」のたびにお客様メニューへ入り続けた。
--      メニュー管理で削除しても、次の一括反映で下書きとして作り直された。
--   2. 一括反映は既にあるメニューの名前・料金・時間・説明を毎回 HPB の値で上書きしており、
--      メニュー管理で直した内容が無言で戻っていた（アプリ側で「まだ無いメニューを作るだけ」に変更）。
--
-- 【追加する列】どちらも NULL 可・既定値なし。既存行は NULL（＝従来どおり HPB にある・未反映の扱い）。
--   missing_since … その施設の店舗ID（hpb_sln_id）で最後まで取得できたのに、その行が見つからなかった
--                   時刻。再び見つかれば取得時に NULL へ戻す。NULL でない行は一括反映しない。
--   applied_at    … 一括反映でお客様メニュー（facility_menus）を作った時刻。NULL でない行は、
--                   メニュー管理で削除されていても作り直さない。
--
-- 【適用順序】新しいアプリのデプロイより【前】に適用すること（新しいアプリはこの 2 列を読み書きする）。
--   列を足すだけなので、旧アプリのまま適用しても動作は変わらない（旧アプリはこの列に触れない）。
-- 【権限】表単位の GRANT と RLS ポリシー（hpb_menu_durations_member_all）が新しい列にもそのまま効く。
--   関数・ポリシー・インデックスは変えていない。
ALTER TABLE public.hpb_menu_durations
  ADD COLUMN IF NOT EXISTS missing_since timestamptz,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

COMMENT ON COLUMN public.hpb_menu_durations.missing_since IS
  'HPB の最新の取得（最後まで取得できたもの）に無かった時刻。NULL 以外は一括反映しない。再び取得できたら NULL に戻す。';
COMMENT ON COLUMN public.hpb_menu_durations.applied_at IS
  '一括反映で facility_menus を作った時刻。NULL 以外はメニュー管理で削除されていても作り直さない。';
