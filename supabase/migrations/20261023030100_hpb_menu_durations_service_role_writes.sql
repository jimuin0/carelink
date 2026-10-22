DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

-- HPB メニュー取り込み（hpb_menu_durations）: ブラウザからの直接書き込みを閉じる（2026年10月23日）。
-- 20261023030000_hpb_import_tracking.sql の続き。
--
-- 【穴】ポリシー hpb_menu_durations_member_all は FOR ALL で「その施設のメンバーか」しか見ておらず、
--   authenticated には表単位の INSERT / UPDATE / DELETE 権があった。API が断る role='staff' を含む
--   どのメンバーも PostgREST を直接叩けば、applied_at / missing_since を消す・store_id を今の店舗IDへ
--   書き換える・kind を 'coupon' から 'menu' へ変える・kind='menu', price=1 のような行を足す、ができた。
--   次にオーナーが「お客様メニューへ一括反映」を押すとその行が下書きメニューになり、
--   「非公開のメニューをすべて公開する」で公開され得る。一括反映の安全確認（クーポンは作らない・
--   掲載終了／別の店舗IDの行は作らない・削除したものは作り直さない）はこれらの列に依存している。
--   RLS では触ってよい列を絞れないため、書き込みの権限そのものを撤回する。
--
-- 【書き込み経路】すべて service_role（RLS・GRANT を通らない）で、この migration の影響を受けない:
--   /api/admin/hpb-menus（取得・店舗ID・手直し）、/api/admin/hpb-menus/apply（一括反映）、
--   /api/cron/hpb-menu-scrape（夜間取得）。ブラウザ（authenticated）からこの表を読み書きする
--   コードは旧アプリ・新アプリとも 1 箇所も無い（一覧も API 経由）。
-- 【適用順序】アプリのデプロイの前後どちらでもよい（旧アプリもブラウザから書き込んでいない）。
-- 【読み取り】多層防御として、owner / admin のメンバーだけが自施設の行を読めるポリシーを残す
--   （gbp_audit_cache の facility_members_gbp_audit と同じ形）。
DROP POLICY IF EXISTS hpb_menu_durations_member_all ON public.hpb_menu_durations;
DROP POLICY IF EXISTS hpb_menu_durations_member_read ON public.hpb_menu_durations;
CREATE POLICY hpb_menu_durations_member_read ON public.hpb_menu_durations FOR SELECT TO authenticated USING (facility_id IN (SELECT facility_id FROM public.facility_members WHERE user_id=(SELECT auth.uid()) AND role IN ('owner','admin')));

REVOKE ALL ON public.hpb_menu_durations FROM anon, authenticated;
GRANT SELECT ON public.hpb_menu_durations TO authenticated;
