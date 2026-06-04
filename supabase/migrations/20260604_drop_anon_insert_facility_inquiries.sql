-- ============================================================
-- CareLink: facility_inquiries anon INSERT ポリシー削除 (2026-06-04)
-- ============================================================
-- 背景（事実・コード確認済み）:
--   src/components/facility/InquiryForm.tsx は従来ブラウザの anon キーで
--   facility_inquiries へ直接 INSERT していた。RLS の
--     "Anyone can insert inquiries" ON facility_inquiries FOR INSERT TO anon
--       WITH CHECK (true)
--   は auth.* を一切参照しない permissive ポリシーで、公開 anon キーさえあれば
--   CSRF / rate-limit / サーバ検証を経由しない無制限・無検証の投入を許していた
--   （salons / facility_reviews と同型の発症前構造脆弱性）。
--
-- 対策（恒久・真の予防）:
--   書き込みをサーバ API /api/inquiry（service_role + withRoute）へ集約済み。
--   service_role は RLS をバイパスするため、本ポリシー削除後も正規の投稿は API 経由で
--   継続でき、サーバを通さない anon 直 INSERT のみが物理的に不能化される。
--
-- 適用順序（重要）:
--   先に API 集約コードを本番デプロイし、その後に本 migration を適用すること。
--   逆順だと現行の InquiryForm 直 INSERT が一時的に失敗する。
--
-- 冪等・ドリフト耐性:
--   名前固定の DROP に加え、facility_inquiries の INSERT で anon を含む全ポリシーを
--   動的走査して削除する。再実行は no-op。将来の名称揺れにも追従する。
-- ============================================================

DROP POLICY IF EXISTS "Anyone can insert inquiries" ON facility_inquiries;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'facility_inquiries'
      AND cmd = 'INSERT'
      AND 'anon' = ANY (roles)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON facility_inquiries', pol.policyname);
  END LOOP;
END $$;
