-- 監査ログ（audit_logs）を service_role 専用にする（2026年10月22日）。
--
-- 【それまでの状態】audit_logs_facility_member_read が「その施設のメンバーであること」だけで
-- 自施設の行を全列読ませていた。来院者が予約をキャンセル・日時変更すると、その施設の行に
-- 来院者の user_id・IP アドレス（ip_address）・ブラウザ情報（user_agent）が残るため、
-- 店舗のメンバーは自分のセッションで PostgREST を直接叩くだけで、予約者ごとの IP を読めた
-- （record_id から予約に結び付けられる）。運営が /api/admin/facility-verify で認証バッジを
-- 付け外ししたときの運営者の IP・UA も同じく店舗から見えた。プライバシーポリシーの
-- 「本人の同意なく第三者に提供しない」範囲を超える。
-- audit_logs_admin_read（profiles.role='admin'）も同じく生の行を全件読ませる。
--
-- 【アプリへの影響】無い。audit_logs を読むコードは 1 つも無い（src・e2e を全走査。
-- アプリは src/lib/audit-logger.ts が service_role で INSERT するだけ）。DB 側の書き込みは
-- SECURITY DEFINER のトリガ（audit_log_new_user / audit_log_new_salon）と、service_role
-- 専用の RPC（setup_facility_from_registration ほか）だけで、どれも anon / authenticated の
-- 権限を使わない。将来、店舗や運営に監査履歴を見せる必要が出たら、ip_address・user_agent・
-- 他人の user_id を出さないサーバーの API（service_role）を別に用意すること。
--
-- 【本番の適用順序】いつ適用してもよい（今のコードも新しいコードも audit_logs を読まない）。
-- ポリシーを消したうえで権限も撤回する（どちらか片方が戻っても開かない＝二重に閉じる）。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

DROP POLICY IF EXISTS audit_logs_facility_member_read ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_admin_read ON public.audit_logs;
REVOKE ALL ON public.audit_logs FROM anon, authenticated;

COMMENT ON TABLE public.audit_logs IS
  '重要操作の監査ログ。90日で自動削除。'
  'INSERT / SELECT とも service_role のみ（2026-10-22: 来院者の IP・UA を店舗へ見せないため、'
  'anon / authenticated の権限とポリシーを撤回）。';
