-- 施設の住所カラムを draft 作成時は NULL 許容に緩和（スケール監査 #1 根本対策）
--
-- 事実: facility_profiles.prefecture / city / address は 20260321_facilities_phase1.sql で NOT NULL。
--   一方 /api/facility/setup は施設を status='draft' で作成し、これらに null を入れる
--   （onboarding は施設名と業種しか送らない）。結果、NOT NULL 違反で新規施設が一切作成できない。
--
-- 設計: 施設は「①draft 作成 → ②管理画面で住所等を入力 → ③公開」のライフサイクル。
--   作成段階で住所を強制するのは設計に反する。住所の必須化は「公開段階のゲート」
--   （src/app/api/admin/settings の action=status published 検証）に一元化する。
--   これにより空施設・住所なし施設の公開を構造的に封鎖しつつ、draft 作成は必ず成功する。
--
-- 冪等: 既に nullable なら ALTER ... DROP NOT NULL は no-op（再実行可）。本番の既存施設は
--   全件 prefecture を保持しているため緩和の影響なし。
ALTER TABLE facility_profiles ALTER COLUMN prefecture DROP NOT NULL;
ALTER TABLE facility_profiles ALTER COLUMN city DROP NOT NULL;
ALTER TABLE facility_profiles ALTER COLUMN address DROP NOT NULL;
