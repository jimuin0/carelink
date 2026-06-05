-- ============================================================
-- CareLink: nps_surveys anon/authenticated 直接 INSERT ポリシー撤去 (2026-06-02)
-- ============================================================
-- 背景（事実・コード確認済み）:
--   NPS の登録は src/app/api/nps/route.ts が createServiceRoleClient()（service_role）
--   経由で nps_surveys に INSERT している。service_role は RLS をバイパスするため、
--   RLS の INSERT ポリシーは正規経路では一切使われない。
--   anon / authenticated が nps_surveys に直接 INSERT するコードパスは
--   src/ 全体を grep しても存在しない（admin 画面は SELECT のみ）。
--
-- 問題（予防的に塞ぐ）:
--   "nps_own_insert" は `WITH CHECK (user_id = auth.uid() OR user_id IS NULL)` で、
--   `user_id IS NULL` 分岐により **未認証でも公開 anon キーで comment（自由記述）を
--   無制限投入**できる。正規経路は service_role 専用のため、この anon INSERT は
--   未使用かつスパム流入経路でしかない。
--
-- 対策（恒久）:
--   "nps_own_insert" を撤去し、INSERT を service_role 経由のみに限定する。
--   SELECT 系ポリシー（nps_own_select / nps_admin_read）は閲覧制御として必要なため維持。
--
-- 冪等: DROP POLICY IF EXISTS のみ。再実行で安全。
-- ============================================================

ALTER TABLE nps_surveys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nps_own_insert" ON nps_surveys;

-- 結果: nps_surveys への INSERT は service_role 経由のみ成立（RLS バイパス）。
--   anon / authenticated の直接 INSERT は RLS により拒否（INSERT ポリシー不在 = deny）。
