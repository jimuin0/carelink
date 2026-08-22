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
-- レビュー／通報のテナント分離を是正する（2026年8月22日・本番の実測に基づく）
-- ============================================================================
-- 【調べ方】本番 RPC `public.get_schema_fingerprint()` の出力（2507行）を直接読んだ。
--   マイグレーション由来の期待値ではなく【本番に今かかっている実物】を根拠にしている。
--   本番の実データは facility_reviews 0件・review_replies 0件・reports 0件・
--   facility_profiles 3件（全て status='published'）＝発症前の予防であり、
--   既存行の書き換えは1行も発生しない。
--
-- 直す穴は4つ。いずれも「Supabase の既定 default privileges が anon / authenticated へ
-- 全 DML を自動付与する」という前提の上で、RLS 側が想定より広く開いていたもの。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. reports: 任意の施設オーナーが【全施設の通報】を読み・書き換え・削除できた
--
--   本番のポリシーは admin_all_reports の1本だけで、
--     USING (EXISTS (SELECT 1 FROM facility_members
--                     WHERE user_id = auth.uid() AND role = 'owner'))
--   と、通報行そのものと一切相関していない（reports.target_id とも facility とも結ばれない）。
--   FOR ALL のため SELECT / UPDATE / DELETE 全てが対象で、
--     - 自分の施設への通報を消して証拠を無かったことにできる
--     - 他店への通報を読める（通報者の reporter_user_id / reporter_ip 付き＝通報者の特定）
--   の2つが同時に成立していた。/register からセルフサーブで誰でも owner になれるので、
--   「オーナーであること」は権限の根拠にならない。
--
--   アプリ側に reports を読む経路は【1本も無い】（src 全体で from('reports') は
--   src/app/api/report/route.ts の INSERT 1箇所のみ・しかも service_role）。
--   よってポリシーを落として service_role 専用にしても失われる機能は無い。
--   INSERT 権は既に撤回済み（本番の grant を実測して確認）なので SELECT/UPDATE/DELETE を撤回する。
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS admin_all_reports ON public.reports;
REVOKE SELECT, UPDATE, DELETE ON public.reports FROM anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. facility_reviews: 施設が【客の書いた本文と星】を書き換えられた
--
--   facility_reviews_member_update は FOR UPDATE・USING/WITH CHECK とも
--   「その施設のメンバーであること」しか見ていない。RLS は列を絞れないため、
--   PostgREST を直接叩けば rating・comment・reviewer_name・is_flagged・user_id まで
--   自由に書き換えられる（トリガ trigger_update_facility_rating が平均点を再計算するので、
--   星の書き換えはそのまま施設の評価点の水増しになる）。
--
--   管理画面が実際に必要としているのは status（公開／非表示のトグル）だけ
--   （src/app/admin/reviews/page.tsx は .update({ status }) のみ。返信は別表 review_replies へ
--   INSERT する）。よって【列レベル GRANT】で status だけに絞る。RLS では列を絞れないので、
--   ここは GRANT が唯一の手段。
--
--   併せてポリシーを owner/admin 限定・authenticated 限定にする
--   （facility_reviews_member_read と条件を揃える。roles=PUBLIC のままだと将来 anon に
--   UPDATE 権が戻った瞬間に穴が再開する）。
--   INSERT / DELETE は /api/review が service_role で行うため anon / authenticated から撤回する。
-- ----------------------------------------------------------------------------
REVOKE UPDATE, INSERT, DELETE ON public.facility_reviews FROM anon, authenticated;
GRANT UPDATE (status) ON public.facility_reviews TO authenticated;

DROP POLICY IF EXISTS facility_reviews_member_update ON public.facility_reviews;
CREATE POLICY facility_reviews_member_update ON public.facility_reviews
  FOR UPDATE TO authenticated
  USING (
    facility_id IN (
      SELECT fm.facility_id FROM public.facility_members fm
      WHERE fm.user_id = auth.uid() AND fm.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  )
  WITH CHECK (
    facility_id IN (
      SELECT fm.facility_id FROM public.facility_members fm
      WHERE fm.user_id = auth.uid() AND fm.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );


-- ----------------------------------------------------------------------------
-- 3. update_facility_rating(): 施設が口コミを非表示にしても平均点が更新されなかった
--
--   この関数は SECURITY INVOKER（本番実測 secdef=f）で facility_profiles を UPDATE する。
--   facility_profiles には SELECT ポリシーしか無いため、authenticated 文脈（＝管理画面の
--   ブラウザクライアントから status を切り替えたとき）に走ると、RLS が新行を弾いて
--   【0行更新・例外なし】で終わる。エラーも出ないので誰も気づけない。
--   API 経由（/api/review・service_role）では RLS を素通りするので発症せず、
--   管理画面のトグルのときだけ rating_avg / rating_count が置いていかれる。
--
--   集計トリガは「その施設の公開レビュー全部」を数える性質上、呼び出し元の可視性に
--   依存してはいけない。SECURITY DEFINER に変え、search_path を固定する
--   （secdef-search-path-lint.yml が SECURITY DEFINER への search_path 固定を要求する）。
--   本体 SQL は 20260722000003 の定義を一字一句そのまま維持する（変えたのは属性2つだけ）。
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_facility_rating()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE facility_profiles SET
      rating_avg = COALESCE((
        SELECT ROUND(AVG(rating)::numeric, 1)
        FROM facility_reviews
        WHERE facility_id = NEW.facility_id AND status = 'published' AND is_flagged = FALSE
      ), 0),
      rating_count = (
        SELECT COUNT(*)
        FROM facility_reviews
        WHERE facility_id = NEW.facility_id AND status = 'published' AND is_flagged = FALSE
      )
    WHERE id = NEW.facility_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE facility_profiles SET
      rating_avg = COALESCE((
        SELECT ROUND(AVG(rating)::numeric, 1)
        FROM facility_reviews
        WHERE facility_id = OLD.facility_id AND status = 'published' AND is_flagged = FALSE
      ), 0),
      rating_count = (
        SELECT COUNT(*)
        FROM facility_reviews
        WHERE facility_id = OLD.facility_id AND status = 'published' AND is_flagged = FALSE
      )
    WHERE id = OLD.facility_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;


-- ----------------------------------------------------------------------------
-- 4. review_replies: INSERT ポリシーが無く【口コミへの返信が必ず失敗していた】
--
--   本番のポリシーは review_replies_public_read（FOR SELECT USING (true)）の1本だけ。
--   RLS 有効・INSERT ポリシー不在 ＝ anon / authenticated の INSERT は必ず弾かれる。
--   管理画面（src/app/admin/reviews/page.tsx の submitReply）はブラウザの authenticated
--   クライアントで review_replies へ INSERT するため、押すたびに
--   「返信に失敗しました」になる。本番の review_replies は 0 行で、まだ誰も返信できていない。
--
--   返信できてよいのは「その口コミが付いた施設の owner / admin」だけ。
--   user_id の詐称も同時に塞ぐ（自分以外の user_id では書けない）。
--   UPDATE / DELETE は用途が無いので grant ごと撤回する（ポリシーも作らない＝二重に閉じる）。
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.review_replies FROM anon, authenticated;
GRANT INSERT ON public.review_replies TO authenticated;

DROP POLICY IF EXISTS review_replies_facility_member_insert ON public.review_replies;
CREATE POLICY review_replies_facility_member_insert ON public.review_replies
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.facility_reviews fr
      JOIN public.facility_members fm ON fm.facility_id = fr.facility_id
      WHERE fr.id = review_replies.review_id
        AND fm.user_id = auth.uid()
        AND fm.role = ANY (ARRAY['owner'::text, 'admin'::text])
    )
  );


-- ----------------------------------------------------------------------------
-- 5. facility_menus / facility_photos: ログインしているだけで【全施設】の
--    未公開メニュー・未公開写真が読めた
--
--   anon 向けポリシーは「施設が published であること」を要求しているのに、
--   authenticated 向けの auth_read_menus / auth_read_photos が USING (true) で、
--   ログインするだけで下回りの制限が消えていた。下書き状態の施設（掲載準備中の店）の
--   価格表と写真が、競合を含む任意のログインユーザーから読める。
--
--   anon と同じ「公開施設なら読める」に揃え、加えて「自分が所属する施設なら
--   公開前でも読める」を足す（管理画面が自店の下書きを読むのに必要）。
--   ＝ anon より狭くはならず、他店の下書きだけが閉じる。
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS auth_read_menus ON public.facility_menus;
CREATE POLICY auth_read_menus ON public.facility_menus
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility_profiles fp
      WHERE fp.id = facility_menus.facility_id AND fp.status = 'published'
    )
    OR EXISTS (
      SELECT 1 FROM public.facility_members fm
      WHERE fm.facility_id = facility_menus.facility_id AND fm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS auth_read_photos ON public.facility_photos;
CREATE POLICY auth_read_photos ON public.facility_photos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility_profiles fp
      WHERE fp.id = facility_photos.facility_id AND fp.status = 'published'
    )
    OR EXISTS (
      SELECT 1 FROM public.facility_members fm
      WHERE fm.facility_id = facility_photos.facility_id AND fm.user_id = auth.uid()
    )
  );
