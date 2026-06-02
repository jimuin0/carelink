-- クーポン写真（HPB同等化 #27）: coupons に画像URLと画像応募フラグを追加
-- sort_order は 20260323_phase3_staff_coupons.sql で既存のため追加しない（#29 並び替えはAPIスキーマ拡張のみ）
ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS image_url        TEXT,                       -- クーポン写真URL（carelink-uploads）
  ADD COLUMN IF NOT EXISTS image_submission BOOLEAN NOT NULL DEFAULT false; -- 特集/メルマガ等への画像応募
