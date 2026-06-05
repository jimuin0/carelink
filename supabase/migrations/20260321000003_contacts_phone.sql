-- Add phone column to contacts table
-- 冪等化: catch-up 再適用や手動再実行で 42701 (column already exists) により
-- マイグレーション全体が停止するのを防ぐ（既存DBでも安全に再実行可能にする）。
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone text;
