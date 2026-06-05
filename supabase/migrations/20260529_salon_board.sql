-- SALON BOARD: 店頭/電話予約に対応するため bookings を拡張
--
-- 背景: 既存 bookings.email は NOT NULL だが、店頭・電話予約は
-- お客様のメールアドレスが無いケースが多い。SALON BOARD と同様に
-- 「氏名のみ」で予約登録できるようにするため email を NULL 許可にする。
-- （ネット予約は API 側で email 必須を引き続き担保する）

-- 1) email を NULL 許可に変更
ALTER TABLE bookings ALTER COLUMN email DROP NOT NULL;

-- 2) 予約経路（source）を追加。既存行は 'online'（ネット予約）扱い。
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'online'
  CHECK (source IN ('online', 'walk_in', 'phone'));

COMMENT ON COLUMN bookings.source IS '予約経路: online=ネット予約 / walk_in=店頭 / phone=電話';
