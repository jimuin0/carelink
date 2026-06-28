-- review_helpful の主キー構成を本番に一致させる（制約レベルの fresh-apply 一致）。
--
-- 背景（事実・2026年6月29日 本番 pg_constraint introspection で確定）:
--   本番（ref: xzafxiupbflvgbarrihe）の review_helpful は:
--     - PRIMARY KEY (id)                              ＝ review_helpful_pkey
--     - UNIQUE (review_id, user_id)                   ＝ review_helpful_review_id_user_id_key
--   一方 migration（20260417000024_phase7_hpb_extensions.sql）の CREATE TABLE は:
--     - PRIMARY KEY (review_id, user_id)              ＝ review_helpful_pkey（複合）
--     - id 列は無し → 20260629000002 で「NOT NULL DEFAULT gen_random_uuid() の素の列」として追加済
--   よって fresh-apply（supabase start）では主キーが複合のままで、本番（PK=id）と乖離する
--   【制約ドリフト】が残っていた（列ドリフトテストは列名のみ検査のため検知不能）。
--   PostgREST の単一行エンドポイント / upsert は PK 構成に依存するため、本番と挙動を一致させる。
--
-- 対応（冪等・状態判定つき）:
--   現在の主キー列が「複合 (review_id, user_id)」のとき【だけ】本番構成へ変換する。
--   既に PK(id)（＝本番状態）なら何もしない。これにより:
--     - fresh-apply（複合PK）→ 本番構成（PK(id)＋UNIQUE(review_id,user_id)）へ確定的に変換。
--     - 本番へ誤って再適用しても no-op（本番は既に PK(id) のため条件不成立）＝副作用ゼロ。
--   ※ 本 migration は 20260629000002 の後に走り、その時点で id 列は必ず存在する。
DO $$
DECLARE
  v_pk_cols text[];
BEGIN
  SELECT array_agg(a.attname ORDER BY a.attname)
  INTO v_pk_cols
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.review_helpful'::regclass
    AND c.contype = 'p';

  -- 複合PK（fresh-apply 状態）のときのみ本番構成へ変換する。
  IF v_pk_cols = ARRAY['review_id', 'user_id'] THEN
    ALTER TABLE review_helpful DROP CONSTRAINT review_helpful_pkey;
    ALTER TABLE review_helpful ADD CONSTRAINT review_helpful_pkey PRIMARY KEY (id);
    ALTER TABLE review_helpful
      ADD CONSTRAINT review_helpful_review_id_user_id_key UNIQUE (review_id, user_id);
  END IF;
END $$;
