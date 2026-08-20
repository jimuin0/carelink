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
-- salons.claimed_by_user_id / salons.claimed_at を新設する（2026年8月20日）
-- ============================================================================
-- 【なぜこの列が要るか】
--   /register の入力を /admin/onboarding が管理画面へ引き継ぐキーは、いまも
--   「メールの一致（canonical・20260820000004）」だけ。salons.email は一度も検証されて
--   おらず、他人のメールアドレスで申し込むだけで別人の登録内容（住所・電話・写真等）を
--   横取りできる（所有権の証明になっていない）。
--
--   salons.id を URL・メールリンクへ載せる案は敵対検証で却下済み（GA4/Clarity/Vercel
--   Analytics・signup の emailRedirectTo・アクセスログへ残るため）。恒久対策は
--   POST /api/salons が成功した「その場のブラウザ」にだけ、salons.id を運ぶ署名付き
--   HttpOnly Cookie を発行し（src/lib/salon-claim.ts）、/api/facility/setup がそれを
--   引き継ぎ元として使う方式。この2列は「Cookie 経由で引き継ぎ済みの行」を
--   条件付き UPDATE（CAS）で一度だけ焼き切るための状態列で、二重取り込みと
--   （Cookie 喪失時の）メール一致フォールバックの両方が同じ行を再取得しないようにする。
--
-- 列の意味:
--   claimed_by_user_id … この salons 行の内容を facility_profiles へ取り込んだ auth.users.id。
--     NULL のまま＝未取り込み。ON DELETE SET NULL: claim したユーザーが退会しても、
--     salons 行自体（掲載申込の記録）は消さない。CASCADE にすると退会のたびに
--     登録申込の履歴が無言で消え、監査ログ（audit_logs）だけが残る一貫性のない状態になる。
--   claimed_at … claim した時刻。運営が「いつ・誰が」取り込んだかを追える（unclaim 導線の
--     判断材料にもなる）。
--
-- 安全性:
--   ADD COLUMN IF NOT EXISTS・NOT NULL 制約なし・DEFAULT なし（NULL=未 claim の自然な
--   初期値）なので、既存行への影響はゼロ。
ALTER TABLE public.salons
  ADD COLUMN IF NOT EXISTS claimed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
