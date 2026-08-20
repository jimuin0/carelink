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
-- salons.registration_followup_sent_at を新設する（2026年8月20日）
-- ============================================================================
-- 【なぜこの列が要るか（実データで確定）】
--   本番の salons は 8 件あるのに facility_profiles は 3 件。差の 5 件は
--   「登録フォーム(/register)は送信したがアカウント作成(/auth/signup)まで
--   到達しなかった」申込者。onboarding-followup cron は facility_profiles
--   だけを対象にしている（この 5 件はどのフォローからも一生接触されない）。
--
--   onboarding-followup cron に salons 向けの第2パスを足し、
--   「登録はしたがアカウントを作っていない申込者」へフォローメールを送る。
--   送信済みかどうかを判定する列が salons に無かった（schema-snapshot.json で
--   確認済み）ため、CAS claim（二重送信防止）と再送判定の両方に使う
--   timestamptz 列をここで新設する。facility_profiles.onboarding_email_sent_at
--   と同じ役割・同じ型。
--
-- 安全性:
--   ADD COLUMN IF NOT EXISTS・NOT NULL 制約なし・DEFAULT なし（NULL=未送信の
--   自然な初期値）なので、既存行への影響はゼロ（全行 NULL で始まる＝全件が
--   フォロー対象候補になる。これは意図通り＝既存の未接触申込者も次回 run で拾う）。
ALTER TABLE public.salons
  ADD COLUMN IF NOT EXISTS registration_followup_sent_at timestamptz;
