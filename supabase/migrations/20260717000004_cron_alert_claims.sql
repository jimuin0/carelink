-- schema-drift-check アラートの claim-first テーブル（重複 Slack 警報の物理封鎖）
--
-- 背景: cron は三重化（GitHub Actions + pg_cron + Render）で同一スケジュール
-- （JST 02:40）にほぼ同時発火する。schema-drift-check は driftCount>0 のとき
-- alertWarning（Slack）を無条件発火する作りだったため、同一ドリフトに対して
-- 複数スケジューラが同時に警報を送り、Slack に重複通知が飛んでいた。
-- alertWarning 自体はスレッド集約のみで送信（chat.postMessage 呼び出し自体）は
-- 毎回行われるため、集約では重複を防げない。
--
-- birthday_notifications（migration 20260616000001）と同型の claim-first 設計：
-- 送信前に (job_name, claim_key) を INSERT して「送信権」を claim する。
-- PRIMARY KEY 制約により、同じ claim_key への2つ目の INSERT は 23505 で失敗する
-- （= 他スケジューラが先に claim・送信済み、という意味で扱う）。
-- claim_key は「日付＋drift内容の指紋」で構成するため、同日同内容の drift は
-- 1通のみ通知され、内容が変われば別キーとして再通知される。
CREATE TABLE IF NOT EXISTS cron_alert_claims (
  job_name   text        NOT NULL,
  claim_key  text        NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_name, claim_key)
);
ALTER TABLE cron_alert_claims ENABLE ROW LEVEL SECURITY;
-- service_role のみアクセス可（cron 専用）。anon/authenticated ポリシーは作らない
-- （birthday_notifications と同方針）。
