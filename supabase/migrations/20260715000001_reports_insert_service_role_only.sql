-- 通報(reports)の直INSERT経路を閉じる(2026年7月15日・PR#477 要ログイン化のDB側恒久根治)
--
-- 背景：旧ポリシー "user_insert_report" は WITH CHECK (reporter_user_id = auth.uid() OR reporter_user_id IS NULL)
-- で「reporter_user_id を NULL にすれば誰でも INSERT 可」を許していた。API(/api/report)は service_role で
-- 書き込むためこのポリシーに依存しておらず、PostgREST 直叩きで API の認証・CSRF・レート制限・重複ブロックを
-- 全てバイパスして匿名通報を挿入できる状態だった(2026年7月15日に anon キーの無効データプローブで
-- 22P02(=権限通過)を実測し確定)。
--
-- 根治：通報の書き込みは API(service_role) のみとする。contact_replies(PR#155)と同型の
-- 「直接書き込み全拒否・service_role 限定」パターン。SELECT 系ポリシーには触れない。

drop policy if exists "user_insert_report" on reports;

-- RLS は既存で有効(INSERTポリシーが無くなることで service_role 以外の INSERT は既定拒否)。
-- さらに GRANT 層でも二重に閉じる(RLSと権限の多層防御)。
revoke insert on reports from anon, authenticated;
