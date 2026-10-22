-- 施設 Q&A: 来院者が作れるのは「回答待ちの質問」だけにする（2026年10月22日）。
-- 2 本組の 1 本目。2 本目＝20261022210300_facility_qa_close_browser_insert.sql。
--
-- 【それまでの状態】facility_qa_user_insert の WITH CHECK は「自分の user_id であること」しか
-- 見ておらず、authenticated は表単位で全列の INSERT 権を持っていた。そのため、ログインした
-- 人なら誰でも PostgREST を直接叩いて
--   {facility_id, user_id: 自分, question, answer: '保険適用で自己負担0円です',
--    status: 'answered', is_public: true, answered_at: 任意}
-- を INSERT でき、施設ページの Q&A タブ（anon で status='answered' AND is_public=true を表示）に
-- 「施設の回答（A バッジ）」として即座に公開できた。管理画面の未回答件数にも数えられない。
-- また facility_qa_member_all（FOR ALL）と表単位の UPDATE / DELETE 権により、施設メンバーは
-- PostgREST から回答・公開状態を直接書き換えられた（正規の経路＝/api/admin/qa →
-- manage_admin_content_atomic の権限確認と監査ログを素通りする）。
--
-- 【この migration（1 本目）でやること＝今デプロイされているコードを壊さない範囲】
--   * 来院者の INSERT は「status='pending'・回答なし・自分の user_id」に限る（WITH CHECK）。
--     列も facility_id / user_id / question / status / is_public だけに絞る（列レベル GRANT）。
--     これは今の QASection.tsx（デプロイ済み）が送る列そのもの:
--       {facility_id, user_id, question: …, status: 'pending', is_public: true}
--     is_public は「回答したら公開する」という意味で、回答待ちの間は公開読みポリシー
--     （status='answered' が条件）に掛からないので、true でも誰にも見えない。回答（status を
--     answered にする）は service_role の RPC にしかできないので、来院者が公開状態を作れない。
--   * UPDATE / DELETE は anon / authenticated から撤回する（アプリはブラウザから使っていない。
--     回答・公開切替・削除は /api/admin/qa → service_role の RPC だけ）。
--   * 施設メンバーのポリシーは読み取り専用へ置き換える（管理画面はブラウザから一覧を読む）。
--
-- 【2 本目でやること】コードのデプロイ後に、ブラウザからの INSERT そのものを撤回する
-- （質問は /api/facility/qa からサーバーで保存し、店舗へメールで知らせる）。
--
-- 【本番の適用順序】① この migration → ② コードをデプロイ → ③ 2 本目。
--   `supabase db push` は保留分を一括で適用するので、① は 2 本目を含めない状態で push する
--   （手順の詳細は 2 本目の冒頭）。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

-- 権限: 読み取りは公開ページと管理画面のために残す。書き込みは質問の 5 列の INSERT だけ。
-- テーブル単位の REVOKE ALL は SELECT と、同じ権限の列単位 GRANT も外すので、直後に付け直す。
REVOKE ALL ON public.facility_qa FROM anon, authenticated;
GRANT SELECT ON public.facility_qa TO anon, authenticated;
GRANT INSERT (facility_id, user_id, question, status, is_public) ON public.facility_qa TO authenticated;

-- 来院者の質問: 自分の名前で、回答待ちの状態でしか作れない。
DROP POLICY IF EXISTS facility_qa_user_insert ON public.facility_qa;
CREATE POLICY facility_qa_user_insert ON public.facility_qa
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND user_id = (SELECT auth.uid())
    AND status = 'pending'
    AND answer IS NULL
    AND answered_by IS NULL
    AND answered_at IS NULL
  );

-- 施設メンバー: 自施設の Q&A を読むだけ（条件は従来の facility_qa_member_all と同じ）。
DROP POLICY IF EXISTS facility_qa_member_all ON public.facility_qa;
CREATE POLICY facility_qa_member_read ON public.facility_qa
  FOR SELECT TO authenticated
  USING (
    facility_id IN (
      SELECT fm.facility_id FROM public.facility_members fm
      WHERE fm.user_id = (SELECT auth.uid())
    )
  );
