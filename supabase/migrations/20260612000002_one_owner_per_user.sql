-- 1アカウント1施設（HotPepper サロンボード型）を DB レベルで強制する部分 UNIQUE 制約。
--
-- 背景（事実）:
--   facility_members への書き込み経路はアプリ上 api/facility/setup の 1 つのみで、
--   PR#102 で既存所属チェックを .maybeSingle() → .order('created_at').limit(1) に変更し、
--   「1 件でもあれば新規作成を拒否」するコードガードを堅牢化済み（複数行でも壊れない）。
--
-- 本制約の役割（二重防御・発症前予防）:
--   コードがすり抜けても DB が物理的に拒否するよう、owner ロールは 1 user 1 施設までを
--   部分 UNIQUE インデックスで強制する。これにより 1 アカウントが 2 施設目の owner に
--   なることを不可能にする。
--   - staff / admin としての複数施設所属は引き続き許容（owner のみ 1 対 1）。
--   - チェーン運用は店舗ごとに別アカウント（別 owner）で行う方針。
--
-- 適用記録:
--   2026-06-12 本番（ref: xzafxiupbflvgbarrihe）へ Dashboard SQL Editor で適用済み。
--   index のため database.types.ts には現れず、drift gate（CREATE TABLE/FUNCTION 突合）対象外。
create unique index if not exists uq_facility_members_one_owner_per_user
  on facility_members (user_id)
  where role = 'owner';
