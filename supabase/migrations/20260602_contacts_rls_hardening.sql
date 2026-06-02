-- ============================================================
-- CareLink: contacts RLS ハードニング (2026-06-02)
-- ============================================================
-- 目的（予防的・恒久対応）:
--   contacts への anon INSERT ポリシーを撤去する。
--   問い合わせ送信は src/app/api/contact/route.ts が service_role キーで
--   INSERT しており（RLS バイパス）、anon の直接 INSERT は一切使われていない。
--   不要な anon INSERT を残すと「誰でも contacts に書き込める」攻撃面になるため撤去。
--
-- 併せて、本番に存在し得る冗長な service_role 専用ポリシーも撤去する。
--   service_role は RLS を常にバイパスするため、service_role 用ポリシーは無意味。
--
-- 重要: salons / job_seekers の "Allow anonymous insert" は LP フォームが
--   anon キーで直接 INSERT するため **撤去しない**。本 migration は
--   contacts テーブルに限定して DROP する（table 修飾済み）。
--
-- 冪等: DROP POLICY IF EXISTS のみ。何度実行しても安全。
-- ============================================================

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- repo 由来の anon INSERT ポリシー（20260321000000_enable_rls.sql L14）
DROP POLICY IF EXISTS "Allow anonymous insert" ON contacts;

-- 本番に存在し得る別名の anon INSERT ポリシー（命名ゆらぎ対策）
DROP POLICY IF EXISTS "anon_insert_contacts" ON contacts;
DROP POLICY IF EXISTS "Allow anon insert" ON contacts;

-- 冗長な service_role 専用ポリシー（service_role は RLS をバイパスするため不要）
DROP POLICY IF EXISTS "service_role_all_contacts" ON contacts;
DROP POLICY IF EXISTS "Service role full access" ON contacts;

-- 結果: contacts には INSERT ポリシーが残らない。
--   anon / authenticated からの直接 INSERT は RLS により全拒否（deny by default）。
--   問い合わせ送信は service_role 経由のみ成立する（RLS バイパス）= 想定どおり。
