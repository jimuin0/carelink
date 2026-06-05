-- ============================================================
-- CareLink: booking_waitlist / intake_form_responses anon INSERT ポリシー削除 (2026-06-04)
-- ============================================================
-- 背景（事実・コード確認済み）:
--   /api/waitlist・/api/intake は従来 anon キー（NEXT_PUBLIC_SUPABASE_ANON_KEY）で
--   INSERT していた。20260602 の hardening で WITH CHECK を
--     (user_id IS NULL OR user_id = auth.uid())
--   に絞り user_id 詐称は塞いだが、guest 送信（user_id = NULL）の経路は依然
--   anon キーで直接 INSERT 可能であり、公開 anon キーさえあれば API の CSRF /
--   rate-limit / 施設存在確認 / responses サイズ制限を迂回した無制限・無検証の
--   投入（guest 偽装スパム・医療系 PII 注入）が成立した。
--   RLS だけでは「正規 guest」と「攻撃者」を区別できない（双方 anon + user_id NULL）。
--
-- 対策（恒久・真の予防）:
--   両 API の DB 書き込み・参照を service_role に集約済み（createServiceRoleClient）。
--   service_role は RLS をバイパスするため、本ポリシー削除後も guest を含む正規投入は
--   API 経由で継続でき、サーバを通さない anon/PUBLIC 直 INSERT のみが物理的に不能化される。
--   認証判定のみ anon SSR クライアントで継続（cookie セッション解決）。
--
-- 適用順序（重要）:
--   先に service_role 集約コードを本番デプロイし、その後に本 migration を適用すること。
--   逆順だと現行 API（anon insert 依存）が一時的に失敗する。
--
-- 冪等・ドリフト耐性:
--   名前固定の DROP に加え、両テーブルの INSERT で anon / PUBLIC 到達のポリシーを
--   動的走査して削除する。再実行は no-op。将来の名称揺れにも追従する。
-- ============================================================

DROP POLICY IF EXISTS "waitlist_insert" ON booking_waitlist;
DROP POLICY IF EXISTS "intake_response_insert" ON intake_form_responses;

DO $$
DECLARE
  tbl text;
  pol record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['booking_waitlist', 'intake_form_responses'] LOOP
    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = tbl
        AND cmd = 'INSERT'
        AND ('anon' = ANY (roles) OR 'public' = ANY (roles))
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, tbl);
    END LOOP;
  END LOOP;
END $$;
