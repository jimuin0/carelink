-- 2026-06-22: bookings.charges 列を追加（退店レジ会計の明細・Phase B・冪等）。
--
-- 背景（事実・HPB サロンボード相当の一元管理）:
--   退店時の実会計を確定・調整できるよう、会計明細（当日メニュー・物販・割引の行）を
--   bookings.charges(JSONB) に保持する。形式は [{ "type": "menu"|"retail"|"discount",
--   "name": string, "amount": number }]（discount は負の amount）。
--   会計確定時に total_price = Σ amount を再計算して反映し、お預かりは既存列 paid_amount を使う。
--   会計の権威的金額は従来どおり total_price（accounting-export / 売上集計が参照）であり、
--   charges は内訳の保持・表示用。新テーブルではなく列追加とすることで RLS/FK 増分を避け、
--   menu_ids と同じ最小リスクのスキーマ変更とする。
--
-- 冪等性: ADD COLUMN IF NOT EXISTS。再適用しても安全。

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS charges JSONB;

COMMENT ON COLUMN bookings.charges IS '退店レジ会計の明細 [{type:menu|retail|discount, name, amount}]。total_price=Σamount。';
