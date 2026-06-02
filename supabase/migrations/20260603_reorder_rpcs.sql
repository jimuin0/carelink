-- 並び替えの原子化（監査 #13/#14）。id 配列を受け取り sort_order を 0..N-1 で一括設定する。
-- 個別 PATCH の逐次ループ（途中失敗で部分保存・順序不整合）を、単一トランザクション(RPC)に置換する。
-- いずれも facility_id を WHERE に含め、他施設の行を並び替えられないようにする（IDOR防御）。

CREATE OR REPLACE FUNCTION reorder_facility_photos(p_facility_id UUID, p_ids UUID[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE i INT;
BEGIN
  FOR i IN 1 .. array_length(p_ids, 1) LOOP
    UPDATE facility_photos SET sort_order = i - 1
    WHERE id = p_ids[i] AND facility_id = p_facility_id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION reorder_coupons(p_facility_id UUID, p_ids UUID[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE i INT;
BEGIN
  FOR i IN 1 .. array_length(p_ids, 1) LOOP
    UPDATE coupons SET sort_order = i - 1
    WHERE id = p_ids[i] AND facility_id = p_facility_id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION reorder_facility_menus(p_facility_id UUID, p_ids UUID[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE i INT;
BEGIN
  FOR i IN 1 .. array_length(p_ids, 1) LOOP
    UPDATE facility_menus SET sort_order = i - 1
    WHERE id = p_ids[i] AND facility_id = p_facility_id;
  END LOOP;
END;
$$;
