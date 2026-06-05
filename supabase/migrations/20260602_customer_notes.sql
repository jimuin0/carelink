-- お客様カルテのメモ／タグ／次回案内（HPB同等化 #42-#45）
-- 顧客は予約集計ベースで顧客テーブルが無いため、(facility_id, customer_key) で1行に保持する。
-- customer_key は予約集計と同じキー（email もしくは氏名を小文字化したもの）。
CREATE TABLE IF NOT EXISTS salon_customer_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id     UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  customer_key    TEXT NOT NULL,
  note            TEXT,                          -- フリーメモ(#42)
  tags            TEXT[] NOT NULL DEFAULT '{}',  -- タグ/属性ラベル(#43)
  next_visit_date DATE,                          -- 次回案内日(#44)
  next_visit_note TEXT,                          -- 次回案内メモ(#44)
  updated_by      UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (facility_id, customer_key)
);

-- service-role 経由のみ（API側で facility_members の owner/admin を検証）。anon/authenticated にはポリシーを付与しない。
ALTER TABLE salon_customer_notes ENABLE ROW LEVEL SECURITY;
