-- features.slug の UNIQUE 制約を本番一致で補完する（制約レベルの fresh-apply 一致）。
--
-- 背景（事実・2026年6月29日 本番 pg_constraint introspection で確定）:
--   本番（ref: xzafxiupbflvgbarrihe）の features は UNIQUE (slug) 制約を持つ。
--   一方 migration（20260320000002_prod_only_base_tables.sql）の CREATE TABLE は
--   slug を `text NOT NULL` で定義するのみで、別途 partial NON-unique index
--   （20260330000001: idx_features_slug ON features(slug) WHERE is_published）しか無く、
--   slug の一意性を一切担保していなかった。よって fresh-apply（supabase start）では
--   features.slug が重複可能で、本番（UNIQUE 強制）と乖離する【制約ドリフト】が残っていた
--   （列ドリフトテストは列名のみ検査のため検知不能）。
--
-- 冪等: features に slug の UNIQUE 制約が無いときだけ追加する。
--   既に在る（本番状態）なら no-op＝本番再適用は副作用ゼロ。fresh-apply（空テーブル）では
--   重複が無いため確定的に付与できる。
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.features'::regclass
      AND c.contype = 'u'
      AND a.attname = 'slug'
  ) THEN
    ALTER TABLE features ADD CONSTRAINT features_slug_key UNIQUE (slug);
  END IF;
END $$;
