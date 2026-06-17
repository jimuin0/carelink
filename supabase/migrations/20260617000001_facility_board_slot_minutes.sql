-- 20260617000001_facility_board_slot_minutes.sql
-- サロンボード（/admin/schedule）の時間軸の区切り幅を店舗ごとに設定可能にする。
--
-- 【背景・要望】
--   従来サロンボードの時間軸は 1 時間固定の罫線のみだった。店舗ごとに 15/30/60 分の
--   区切りを選べるようにするため、設定値を facility_profiles に保持する。
--
-- 【定義】
--   board_slot_minutes: グリッド罫線と空き帯クリック時のスナップ単位（分）。
--   既定 60（＝従来の 1 時間表示）なので、本カラム追加だけでは既存店舗の見た目は不変。
--   許可値は 15/30/60（アプリ側 zod enum・設定 UI のセレクタと一致）。
--
-- 【適用順序の注意（重要）】
--   読み取り側 src/app/admin/schedule/page.tsx は本カラム取得失敗時に 60 へフォールバック
--   する実装（列未追加でもボードは落ちない）。よって本 migration の本番適用前にコードを
--   デプロイしても安全。適用後は database.types.ts を再生成し repo↔本番を一致させること。

ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS board_slot_minutes INTEGER NOT NULL DEFAULT 60
  CHECK (board_slot_minutes IN (15, 30, 60));
