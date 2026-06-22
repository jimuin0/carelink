-- 2026-06-22: bookings.status の CHECK 制約に 'arrived'（受付＝来店中）を追加（冪等）。
--
-- 背景（事実・HPB サロンボード相当の一元管理のための新機能）:
--   従来の状態機械は confirmed → completed で、HPB にある「受付済（来店中）」の中間状態が
--   無かった。来店した客を「受付」として把握する段を設けるため、新ステータス 'arrived' を導入する。
--   状態遷移: confirmed → arrived → completed（confirmed → completed の受付スキップも従来どおり許可）。
--   arrived からは completed / cancelled / no_show へ遷移可能。
--   'arrived' では来店記録・ポイントは付与しない（従来どおり completed 進入時のみ applyCompletionSideEffects）。
--
-- 修正:
--   CHECK 制約に 'arrived' を追加。新集合は旧集合の上位集合のため既存行は全て通過＝無破壊。
--   制約名 bookings_status_check（20260323000003_phase4_bookings.sql の inline CHECK 由来、
--   20260621000004 で 'cancel_fee_paid' を追加済み）を再定義する。
--
-- 冪等性: DROP CONSTRAINT IF EXISTS → ADD CONSTRAINT。再適用しても安全。

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show', 'cancel_fee_paid'));
