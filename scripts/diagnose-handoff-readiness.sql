-- ============================================================================
-- 引き継ぎ経路の「本番適用状況」を1回で確かめる（2026年8月20日）
-- ============================================================================
-- この環境から本番 DB へは接続できないため、Supabase Dashboard の SQL Editor
-- （project ref: xzafxiupbflvgbarrihe）に貼って実行する SELECT 専用ランブック。
--
-- 🔴 接続先を必ず結果に残すこと。過去に別プロジェクト（soel）で実行し、存在しない
--    事故を報告しかけた事例がある（CLAUDE.md「触るときの鉄則」項目5）。
--
-- 何を確かめるか:
--   (1) migration 20260820000004（email_canonical）が本番に入っているか
--       … 入っていなければ PR#623 のメール突合は【一度も機能しない】。
--   (2) migration 20260820000005（salons.claimed_*）が本番に入っているか
--       … 入っていなければ claim 方式は Cookie を持っていても引き継げない。
--   (3) handle_new_user の本体がリポジトリと一致しているか
--       … 20260805000001 は「本番へは未適用」と記録されたまま。未適用なら
--         サインアップで入力した phone / prefecture が profiles に入らない。
--   (4) profiles.email が auth.users.email から乖離している件数
--       … auth.users には AFTER INSERT トリガしか無く（UPDATE トリガは存在しない）、
--         コード側にも profiles.email を更新する箇所が 1 つも無い。Dashboard 等で
--         メールを変更すると profiles.email は永久に旧アドレスのまま残り、
--         owner_monthly のニュースレターが【本人がもう持っていないアドレス】へ届く。

-- @check salons.email_canonical
-- @check salons.claimed_at
-- @check salons.claimed_by_user_id
-- @check profiles.email_canonical
-- @check profiles.email

-- 🔴 接続先ガード。CareLink 固有のテーブルが3つとも在る時だけ先へ進む。
--    間違ったプロジェクトのタブに貼っても、ここで落ちて以降のクエリは1つも走らない。
DO $connguard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL
     OR to_regclass('public.facility_menus') IS NULL
     OR to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION
      'このデータベースは CareLink ではありません。Supabase Dashboard のプロジェクトを'
      ' 切り替えてから貼り直してください（CareLink の本番 ref は xzafxiupbflvgbarrihe）。';
  END IF;
END
$connguard$;

SELECT
  (to_regclass('public.facility_profiles') IS NOT NULL) AS is_carelink,

  -- (1)(2) 列の実在。false のものが未適用の migration。
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='salons'
            AND column_name='email_canonical')      AS salons_email_canonical_applied,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='profiles'
            AND column_name='email_canonical')      AS profiles_email_canonical_applied,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='salons'
            AND column_name='claimed_by_user_id')   AS salons_claimed_applied,

  -- (3) 期待値は src/lib/schema-fingerprint.expected.json の
  --     function|handle_new_user()|...|body_md5=e3ae46eb087aac2936d94b84b7c0638a
  --     一致しなければ 20260805000001 が本番へ未適用（＝phone/prefecture が入らない）。
  (SELECT md5(p.prosrc) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='handle_new_user') AS handle_new_user_body_md5,

  -- auth.users に UPDATE トリガが在るか（在るべきものが無いことの確認）。
  (SELECT count(*) FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='auth' AND c.relname='users' AND NOT t.tgisinternal) AS auth_users_trigger_count,

  -- (4) profiles.email と auth.users.email の乖離。0 でなければ旧アドレスへ送っている。
  -- 大小文字だけの違いは同じ受信箱なので数えない（乖離件数を水増ししない）。
  (SELECT count(*) FROM public.profiles pr
     JOIN auth.users u ON u.id = pr.id
    WHERE lower(coalesce(pr.email,'')) <> lower(coalesce(u.email,''))) AS profiles_email_stale_count,

  -- 参考: 引き継ぎ待ちの申込（未 claim・却下でない）件数。
  (SELECT count(*) FROM public.salons) AS salons_total;
