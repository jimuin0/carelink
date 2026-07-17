-- at_risk クーポンの並行cron二重発行防止（TOCTOU封鎖・UTC日バケットの部分UNIQUE）
-- 30日窓の業務ルールはアプリ側 recheck が担い、本インデックスは同日並行runのレースのみを物理封鎖する。
--
-- 背景: customer-segment cron（週次・日曜16:00 JST=07:00 UTC）は GitHub Actions / pg_cron / Render の
-- 三重化により同時刻近傍で並行 invocation しうる。at_risk クーポン発行は「30日窓の recheck SELECT →
-- 0件なら INSERT」の2段でDBレベルの排他が無い古典的TOCTOU。user_coupon_codes の既存 UNIQUE は
-- code列（ランダム生成）のみで (facility_id, email, reason) の組には制約が無く、並行2 run が両方
-- recheck 0件を見て両方 INSERT に成功し「同一顧客に別コードのクーポン2枚＋メール2通」が成立しうる。
--
-- (created_at AT TIME ZONE 'UTC')::date を式に使う理由:
--   date(created_at) をそのまま書くと timestamptz→date のキャストは session の TimeZone 設定に
--   依存し STABLE（IMMUTABLE ではない）ため、インデックス式には使えない。
--   timezone('UTC', created_at) は timestamptz→timestamp（TZ非依存）、それを ::date にキャストする
--   経路は IMMUTABLE でありインデックス式として使用できる。
--
-- 全スケジューラの発火は 07:00 UTC 近傍に集中し、日付境界（00:00 UTC）を跨ぐ並行発火は
-- 観測された最大遅延（283分）でも到達しないため、UTC日単位のバケットで並行レースは完全に閉じる。
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_coupon_codes_at_risk_daily
  ON user_coupon_codes (facility_id, email, ((created_at AT TIME ZONE 'UTC')::date))
  WHERE reason = 'at_risk';
