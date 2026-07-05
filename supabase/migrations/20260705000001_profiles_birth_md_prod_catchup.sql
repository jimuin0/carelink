-- profiles.birth_md の prod-catchup migration（監査P3・Contract Test逆方向ドリフト是正）。
--
-- 背景（事実）: 誕生日クーポンcron(birthday-coupon)がprofiles.birth_dateへ先頭%付きLIKEで
-- 全件スキャンしていた問題（監査P3）の恒久対策として、神原さんがSupabase SQL Editorで
-- 以下と同一のDDLを本番へ直接適用済み（本ファイルはその事後記録・fresh-apply再現性のため）。
--
-- to_char(date,text)はSTABLE扱いで生成列に使えない(42P17)ため、IMMUTABLEなextract+lpadで
-- 'MM-DD'（ゼロ埋め）を組み立てる。索引を活かすアプリ側 .eq('birth_md', todayMD) への変更は
-- 別途コードPRで対応する（本ファイルはDDLのみ）。
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birth_md text
  GENERATED ALWAYS AS (
    lpad(extract(month from birth_date)::int::text, 2, '0') || '-' ||
    lpad(extract(day   from birth_date)::int::text, 2, '0')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_profiles_birth_md
  ON public.profiles (birth_md) WHERE birth_md IS NOT NULL;
