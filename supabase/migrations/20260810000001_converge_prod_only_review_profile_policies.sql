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
-- 本番にだけ生存していた RLS ポリシー 3 件の収斂（2026-08-10）
-- ============================================================================
-- 【発見経緯】本番DBとshadow（全 migration 適用済みDB）を pg_policies で突合した結果、
--   以下の 3 件がいずれの migration ファイルにも存在しないにもかかわらず本番にだけ
--   生存していることが判明した（本番のみの手動運用アーティファクト）。
--
--     A) facility_profiles "Members read own facility"
--        (SELECT, authenticated, USING id IN (SELECT facility_id FROM
--         facility_members WHERE user_id=auth.uid()))
--     B) facility_reviews "Members read own reviews"
--        (SELECT, authenticated, USING facility_id IN (SELECT facility_id FROM
--         facility_members WHERE user_id=auth.uid()) — ロール絞り込み無し)
--     C) facility_reviews "facility_reviews_own_read"
--        (SELECT, authenticated, USING user_id=auth.uid())
--
--   この 3 件を個別に検証した結果（司令塔による敵対検証済み・本 migration では
--   再検証しない）、A と C は正当なアクセス経路を支えており migration へ codify（採用）、
--   B は既に別 migration で意図的に閉じられたはずの穴が本番にだけ生き残っていた
--   ものなので DROP（駆除）する。
--
-- ── A) KEEP（codify）: facility_profiles "Members read own facility" ─────────
--   施設メンバー本人が【自分の施設】のプロファイルを読む経路。公開ステータスに
--   絞る "Authenticated read published" / "Public read published" とは別に、
--   下書き（draft）状態の自施設プロファイルをオーナー・管理者・スタッフ本人が
--   RLS 経由の browser/auth クライアントで読めなければならない。
--   load-bearing:
--     - src/app/admin/settings/page.tsx:86（施設設定画面が自施設の facility_profiles
--       を認証済み browser クライアントで読む。公開前の下書きも表示する必要がある）
--     - src/app/admin/page.tsx:39（管理ダッシュボードのトップが同様に自施設の
--       facility_profiles を RLS 経由で読む）
--   このポリシーが無いと、公開前（status != 'published'）の施設は自分の管理画面
--   からすら読めなくなる（"Authenticated/Public read published" は status='published'
--   に絞っているため下書きを通さない）。
--
-- ── C) KEEP（codify）: facility_reviews "facility_reviews_own_read" ──────────
--   来院者本人が【自分が書いたレビュー】を読む経路（施設メンバーかどうかは無関係）。
--   load-bearing:
--     - src/app/mypage/reviews/page.tsx（自分の投稿済みレビュー一覧を認証済み
--       browser クライアントで読む）
--     - src/app/mypage/reviews/[id]/edit/page.tsx（自分のレビューを編集する前に
--       同じ経路で読む）
--   既存の facility_reviews_member_read / facility_reviews_member_update は
--   施設メンバー（owner/admin）がレビュー"管理"側として読む経路であり、来院者
--   本人が"自分の投稿"を読むための経路は別に必要（user_id=auth.uid() で
--   完結し、facility_members を一切経由しない）。
--
-- ── B) DROP: facility_reviews "Members read own reviews" ─────────────────────
--   本番だけに残存する「取り残された」セキュリティホール。
--   migration 20260420000010_reviews_ip_protection.sql が、facility_reviews に
--   reviewer_ip という PII 列を持たせたうえで、施設メンバーによるレビュー閲覧を
--   意図的に role IN ('owner','admin') に narrowing した
--   （= "facility_reviews_member_read"。上記 pg_policies 実測どおり
--   roles=authenticated かつ using 句に role = ANY (ARRAY['owner','admin']) を含む）。
--   これは reviewer_ip のような機微情報を、閲覧権限の弱い 'staff' ロールの
--   メンバーにまで晒さないための narrowing だった。
--   ところが本ポリシー B はロール絞り込みが一切無く（facility_members に
--   所属してさえいれば owner/admin/staff の別なく facility_id が一致する全
--   レビューを読める）、20260420000010 が閉じたはずの穴をそのまま素通りさせる。
--   つまり B が生きている限り、20260420000010 の narrowing は実質無意味化
--   （facility_reviews_member_read で閉じても B がバイパス経路として残る）。
--   アプリ側にも B を必要とする機能は無い。実際 src/app/admin/reviews/page.tsx:47-48
--   は、レビュー閲覧の前段で facility_members の membership 検索そのものを
--   role IN ('owner','admin') に自己制限しており（= B のような無制限メンバー
--   読み取りに依存していない）、アプリコードは既に狭い経路だけで完結している。
--   よって B は「使われていない・使う必要が無い・使われると PII 漏洩と IDOR に
--   直結する」の3条件が揃った、駆除すべき取り残された穴と判断する。
--
-- 【本 migration の位置付け】
--   本番は既にこの3ポリシーが現状（A/C 存在・B 存在）のまま稼働しているため、
--   本 migration を適用しても本番の実体は変わらない（A/C は DROP→CREATE の
--   冪等な codify、B の DROP は既存ポリシーの削除）。
--   本 migration の主目的は「fresh-apply（CI・新規環境・shadow DB）が本番と
--   同じポリシー集合に収斂すること」であり、これにより
--   src/lib/schema-fingerprint.expected.json の期待値も本番の実体と一致する
--   （A/C を追加・B は元々 expected.json に存在しないため変更不要）。
--
--   🔴 【要人手対応】本 migration は CI・shadow・将来の fresh-apply を本番に
--   収斂させるものであり、A/C の DROP→CREATE は本番側では単なる no-op（冪等）だが、
--   B の DROP POLICY は本番にまだ本 migration が「適用されていない」限り本番の
--   実ポリシーには反映されない。本番の Supabase migration 履歴に本 migration が
--   記録され実行されるまで、本番の facility_reviews には B（脆弱ポリシー）が
--   生存し続ける。したがって本 migration は shadow 検証後、【人が本番へも
--   別途適用する】必要がある（PR 本文に本番適用手順を記載）。冪等なので
--   複数回適用しても安全。
-- ============================================================================

-- ── A) facility_profiles: 施設メンバーが自施設のプロファイルを読む（下書き含む） ──
DROP POLICY IF EXISTS "Members read own facility" ON facility_profiles;

CREATE POLICY "Members read own facility" ON facility_profiles
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT facility_id FROM facility_members WHERE user_id = auth.uid()
    )
  );

-- ── C) facility_reviews: 来院者本人が自分の投稿レビューを読む ────────────────
DROP POLICY IF EXISTS "facility_reviews_own_read" ON facility_reviews;

CREATE POLICY "facility_reviews_own_read" ON facility_reviews
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ── B) facility_reviews: reviewer_ip PII を role 制限なしに晒す取り残された穴を駆除 ──
DROP POLICY IF EXISTS "Members read own reviews" ON facility_reviews;
