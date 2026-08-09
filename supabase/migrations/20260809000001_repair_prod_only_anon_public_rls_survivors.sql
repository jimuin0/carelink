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
-- 本番にだけ生存していた脆弱 RLS ポリシー 6 件の駆除（2026-08-09）
-- ============================================================================
-- 【発見経緯】本番DBとshadow（全 migration 適用済みDB）を pg_policies で突合した結果、
--   過去にセキュリティ修正として DROP 済みのはずのポリシーが本番にだけ 6 件生存していた。
--   各テーブルの anon への GRANT に INSERT/SELECT が実在することも grant 突合で確認済み
--   （＝ RLS ポリシーさえ生きていれば実際に anon/authenticated から書ける/読める）。
--
-- 【"名前不一致 no-op" 説の検証結果（実測・本 migration 作成時点）】
--   6 件それぞれについて、DROP 対象の migration ファイルの DROP 文字列と、本番の
--   生存ポリシー名を突き合わせた。バイト単位（od -An -tx1）でも確認したが、
--   6 件とも隠れた空白・不可視文字は無く、文字列は完全一致していた。
--   さらに実機検証として、ローカル PostgreSQL 16 に Supabase 互換の bootstrap
--   （supabase/shadow/00_bootstrap.sql）を適用したうえで supabase/migrations/*.sql を
--   時系列どおり 200 本全適用し、pg_policies を実際に問い合わせた。結果、6 件とも
--   shadow 側にはそもそも存在しない（＝各 DROP 文は shadow 上で正しく効いている）ことを
--   確認した。したがって「DROP 文の名前指定ミスで no-op していた」可能性は本 migration
--   作成時点で棄却できる。
--
--   結論: 本番だけがこれらの migration（またはこれらを含む一連の適用）を受け取れて
--   いない状態＝job_postings 前例（IF EXISTS 名前不一致）とは別の原因である。
--   2026-08-03 の `20260803000001_restore_missing_triggers.sql`（本番に無かったトリガ
--   2本を復旧）と同型で、「特定の migration だけが本番に飛んでいない」という既知の
--   運用上の欠落パターンに一致する。本番接続で実行された migration 履歴
--   （supabase_migrations.schema_migrations 等）の確認は本セッションでは行っていない
--   （本番へは一切接続していないため）＝ここは未確認と明記する。
--
-- 【本 migration の方針】
--   原因が「未適用」であっても「名前不一致 no-op」であっても、結果として同じ形
--   （対象ポリシーが本番に残っている）になるため、両方に効く形で駆除する:
--     (a) 元 migration と同一の名前固定 DROP（未適用が真因ならこれで十分に消える）
--     (b) pg_policies を動的走査し、テーブル・cmd・ロールの組み合わせで一致するものを
--         名前によらず DROP（名前が想定と違っていても確実に消える。将来の名称揺れにも
--         追従する。列挙ではなく走査にすることで「対象を数え上げて漏らす」class を回避）
--   冪等（何度実行しても安全・2回目以降は各 DROP が no-op）。
--
-- 【REVOKE は行わない】
--   元の 6 件の背景 migration
--   （20260604000001 / 20260420000005 / 20260604000003 / 20260420000008 /
--    20260608000001 / 20260420000001）を全件確認したが、いずれも REVOKE を含んでいない
--   （grep 実測 0 件）。この設計は Supabase の一般原則
--   （ALTER DEFAULT PRIVILEGES で anon/authenticated/service_role に自動 GRANT が付き、
--   実際のアクセス制御は RLS ポリシー側で行う）と整合しており、テーブル単位の
--   INSERT/SELECT GRANT を anon から剥がすと他の正規ポリシー（例: 各テーブルの
--   *_read 系ポリシーが将来 anon 向けに追加された場合など）まで無条件で道連れに
--   広範囲な副作用を持つ。ポリシーが 0 件になれば RLS は既定で全拒否となるため、
--   GRANT を残してもポリティカルな穴は生じない。よって本 migration も REVOKE は行わない。
--
-- 【対象6件と実装（src/ 全件 grep で書込・読取経路を確認済み）】
--   1. facility_inquiries  "Anyone can insert inquiries" (anon INSERT, check=true)
--      → 書込は /api/inquiry（service_role, createServiceRoleClient）に集約済み。
--        InquiryForm.tsx はブラウザから直 INSERT せず fetch('/api/inquiry') のみ。
--   2. facility_inquiries  "auth_read_inquiries" (authenticated SELECT, using=true)
--      → 20260420000005 が同時に作成した "facility_inquiries_member_read"
--        （facility_members の owner/admin にスコープ）が正規の後継。
--        src/app/admin/facility-inquiries/page.tsx はこの後継ポリシーに依存して
--        認証済みブラウザクライアントで SELECT しており、"auth_read_inquiries" を
--        消しても壊れない（後継ポリシーは対象外・触らない）。
--   3. intake_form_responses "intake_response_insert" (PUBLIC INSERT)
--      → 書込は /api/intake（service_role）に集約済み。
--   4. booking_waitlist "waitlist_insert" (PUBLIC INSERT)
--      → 書込は /api/waitlist（service_role）に集約済み。
--   5. referral_uses "Referral uses insert" (PUBLIC INSERT, check=true)
--      → 書込は /api/referral・src/lib/referral.ts（いずれも service_role）に集約済み。
--   6. ab_test_events "ab_test_insert" (PUBLIC INSERT, check=true)
--      → 書込は /api/ab-test（service_role）に集約済み。
--   6件すべて、anon/authenticated ブラウザクライアントからの直接 INSERT/SELECT 経路は
--   コード上に1件も存在しない（service_role 経由のみ）ことを src/ 全件 grep で確認済み。
-- ============================================================================

-- ── 1. facility_inquiries: anon INSERT の駆除 ──────────────────────────────
DROP POLICY IF EXISTS "Anyone can insert inquiries" ON facility_inquiries;

-- ── 2. facility_inquiries: authenticated 無条件 SELECT の駆除 ──────────────
DROP POLICY IF EXISTS "auth_read_inquiries" ON facility_inquiries;

-- ── 3. intake_form_responses: PUBLIC INSERT の駆除 ─────────────────────────
DROP POLICY IF EXISTS "intake_response_insert" ON intake_form_responses;

-- ── 4. booking_waitlist: PUBLIC INSERT の駆除 ──────────────────────────────
DROP POLICY IF EXISTS "waitlist_insert" ON booking_waitlist;

-- ── 5. referral_uses: PUBLIC INSERT の駆除 ─────────────────────────────────
DROP POLICY IF EXISTS "Referral uses insert" ON referral_uses;

-- ── 6. ab_test_events: PUBLIC INSERT の駆除 ────────────────────────────────
DROP POLICY IF EXISTS "ab_test_insert" ON ab_test_events;

-- ============================================================================
-- 動的走査（名前不一致 no-op 対策・将来の名称揺れにも追従）
-- ============================================================================
-- (a) facility_inquiries / intake_form_responses / booking_waitlist /
--     referral_uses / ab_test_events の INSERT ポリシーで、ロールに anon または
--     public を含むものを名前によらず全て DROP する。
--     ⚠️ 列挙ではなく pg_policies を実走査する形にしてあるので、この5テーブルに
--     将来同種の緩いポリシーが別名で増えても、この migration を再実行すれば拾える。
DO $$
DECLARE
  tbl text;
  pol record;
  dropped int := 0;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'facility_inquiries', 'intake_form_responses', 'booking_waitlist',
    'referral_uses', 'ab_test_events'
  ] LOOP
    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = tbl
        AND cmd = 'INSERT'
        AND ('anon' = ANY (roles) OR 'public' = ANY (roles))
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, tbl);
      dropped := dropped + 1;
    END LOOP;
  END LOOP;

  IF dropped > 0 THEN
    RAISE NOTICE '動的走査で追加に % 件の anon/public INSERT ポリシーを削除した（名前固定 DROP で捕まらなかった分）', dropped;
  END IF;
END $$;

-- (b) facility_inquiries の SELECT ポリシーで、ロールに authenticated または
--     public を含み、かつ using 句が無条件（true）のものを名前によらず全て DROP する。
--     正規の後継ポリシー "facility_inquiries_member_read" は using 句が
--     facility_members への EXISTS サブクエリであり `true` 単体ではないため対象外
--     （誤って道連れにしない）。
DO $$
DECLARE
  pol record;
  dropped int := 0;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'facility_inquiries'
      AND cmd = 'SELECT'
      AND ('authenticated' = ANY (roles) OR 'public' = ANY (roles))
      AND qual = 'true'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON facility_inquiries', pol.policyname);
    dropped := dropped + 1;
  END LOOP;

  IF dropped > 0 THEN
    RAISE NOTICE '動的走査で追加に % 件の無条件 authenticated/public SELECT ポリシーを削除した（facility_inquiries）', dropped;
  END IF;
END $$;

-- ============================================================================
-- 自己検証（このステートメント自体が fail-closed。1件でも残っていれば migration ごと失敗する）
-- ============================================================================
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT count(*) INTO remaining
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (tablename = 'facility_inquiries' AND cmd = 'INSERT' AND ('anon' = ANY (roles) OR 'public' = ANY (roles)))
      OR (tablename = 'facility_inquiries' AND cmd = 'SELECT' AND ('authenticated' = ANY (roles) OR 'public' = ANY (roles)) AND qual = 'true')
      OR (tablename = 'intake_form_responses' AND cmd = 'INSERT' AND ('anon' = ANY (roles) OR 'public' = ANY (roles)))
      OR (tablename = 'booking_waitlist' AND cmd = 'INSERT' AND ('anon' = ANY (roles) OR 'public' = ANY (roles)))
      OR (tablename = 'referral_uses' AND cmd = 'INSERT' AND ('anon' = ANY (roles) OR 'public' = ANY (roles)))
      OR (tablename = 'ab_test_events' AND cmd = 'INSERT' AND ('anon' = ANY (roles) OR 'public' = ANY (roles)))
    );

  IF remaining > 0 THEN
    RAISE EXCEPTION '駆除対象の脆弱ポリシーが % 件残っています（DROP に失敗した可能性）。手動で pg_policies を確認してください。', remaining;
  END IF;
END $$;
