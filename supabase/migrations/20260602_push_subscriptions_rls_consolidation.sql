-- ============================================================
-- CareLink: push_subscriptions RLS 統合 (2026-06-02)
-- ============================================================
-- 目的（予防的・恒久対応）:
--   push_subscriptions の RLS ポリシーが 2 系統に分裂している状態を
--   単一の正ポリシーへ統合する。
--
-- 分裂の事実（repo 内）:
--   - 20260330_phase_c_infra.sql:
--       push_subscriptions_own_select / _own_insert / _own_update / _own_delete
--       （操作別に 4 本、いずれも auth.uid() = user_id）
--   - 20260331_push_subscriptions_and_indexes.sql:
--       "Users can manage own push subscription" (FOR ALL, auth.uid() = user_id)
--       "Service role full access"              (FOR ALL, auth.role() = 'service_role')
--
-- 方針:
--   1) 操作別 4 本 + 旧 FOR ALL を全て撤去し、本人のみ全操作可の FOR ALL 1 本に統合。
--   2) "Service role full access" は撤去。service_role は RLS を常にバイパスするため
--      ポリシーがあっても無意味（冗長）。実際の server 側操作（src/lib/push.ts の
--      select/delete）は service_role キーで実行され RLS を通らない。
--
-- 統合後の唯一の正ポリシー:
--   USING / WITH CHECK = auth.uid() = user_id
--   → ログインユーザーは自分の購読のみ参照・登録・更新・削除可能。
--
-- 冪等: DROP POLICY IF EXISTS → CREATE POLICY。再実行時は下の DROP が効くため安全。
-- ============================================================

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- 20260330 由来（操作別 4 本）
DROP POLICY IF EXISTS "push_subscriptions_own_select" ON push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_own_insert" ON push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_own_update" ON push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_own_delete" ON push_subscriptions;

-- 20260331 由来（FOR ALL 本人 + service_role 冗長）
DROP POLICY IF EXISTS "Users can manage own push subscription" ON push_subscriptions;
DROP POLICY IF EXISTS "Service role full access" ON push_subscriptions;

-- 本番に存在し得る別名（命名ゆらぎ対策）
DROP POLICY IF EXISTS "Users manage own push subscriptions" ON push_subscriptions;

-- 統合後の唯一の正ポリシー（本人のみ全操作可）
CREATE POLICY "push_subscriptions_owner_all"
  ON push_subscriptions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
