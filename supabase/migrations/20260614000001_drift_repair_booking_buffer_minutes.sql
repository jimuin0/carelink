-- 20260614000001_drift_repair_booking_buffer_minutes.sql
-- 本番スキーマ・ドリフト修復（実データで確定した根本原因）
--
-- 【事実・根本原因】
--   20260417000006_booking_buffer.sql は get_available_slots を「booking_buffer_minutes 参照版」に
--   更新すると同時に facility_profiles.booking_buffer_minutes を追加する。しかし本番では
--   関数更新のみ反映され、カラム追加が反映されていなかった（スキーマ・ドリフト）。
--   plpgsql は本体内のカラム参照を CREATE 時に検証しないため、関数は作成成功し、
--   実行時に 42703 undefined_column（"column booking_buffer_minutes does not exist"）で失敗していた。
--
-- 【影響（マスクされていた既存バグ）】
--   get_available_slots が全施設で実行時エラー。呼び出し側はいずれも error を握り潰すため顕在化せず:
--     - /api/slots（公開予約フロー）       : const { data } = rpc(...) → 空配列 → 「空き枠なし」
--     - /api/availability（予約カレンダー） : 旧実装も error 握り潰し → 「満枠」表示
--   T7 の集約 RPC get_month_availability が SQL でこのエラーを伝播させたことで発覚した
--   （集約導入前は per-call の握り潰しで隠れていた）。
--
-- 【対策】
--   カラムを冪等に再追加し repo↔本番を一致させる（20260417000006 と同一定義）。
--   既定 0・0〜120 分の CHECK。適用後 get_available_slots が正常化し、/api/slots・/api/availability・
--   集約 RPC の全経路が実データを返す。

ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS booking_buffer_minutes INTEGER DEFAULT 0
  CHECK (booking_buffer_minutes >= 0 AND booking_buffer_minutes <= 120);
