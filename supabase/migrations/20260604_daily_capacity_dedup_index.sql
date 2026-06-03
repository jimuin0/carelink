-- facility_daily_capacity の冗長インデックス除去（round3 監査 #21）
-- UNIQUE (facility_id, capacity_date) が同一列の一意インデックスを自動生成するため、
-- 20260602_daily_capacity.sql で別途作成した idx_daily_capacity_facility_date は重複（索引メンテのみ二重）。
-- UNIQUE 由来の索引が (facility_id, capacity_date) のルックアップを引き続き担保するため、安全に削除できる。
DROP INDEX IF EXISTS idx_daily_capacity_facility_date;
