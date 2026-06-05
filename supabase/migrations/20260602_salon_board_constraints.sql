-- サロンボード: アプリ層チェックのみだった上限/重複をDB層で担保（競合・連打耐性）

-- #19 ブログ投稿者は施設あたり最大5名。count→insert のアプリ層チェックは競合で破れるため、
-- advisory lock で同一施設の追加を直列化する原子的 RPC を用意する（公開予約 RPC と同方式）。
CREATE OR REPLACE FUNCTION create_blog_author_atomic(p_facility_id UUID, p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
  v_count INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('blog_author:' || p_facility_id::text));
  SELECT COUNT(*) INTO v_count FROM blog_authors WHERE facility_id = p_facility_id;
  IF v_count >= 5 THEN
    RAISE EXCEPTION 'AUTHOR_LIMIT: 投稿者は最大5名までです';
  END IF;
  INSERT INTO blog_authors (facility_id, name) VALUES (p_facility_id, p_name) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- #20 メニュー名の重複（同一施設内）をDBで一意化。maybeSingle→insert のアプリ層チェックは
-- 競合・連打で破れるため、施設×メニュー名（前後空白除去）の一意インデックスを付与する。
-- 注意: 既存に重複がある場合は作成に失敗するため、適用前に重複を解消すること。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_facility_menu_name
  ON facility_menus (facility_id, btrim(name));
