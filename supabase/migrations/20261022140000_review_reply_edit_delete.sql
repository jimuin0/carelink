-- 口コミへの返信を、投稿後に編集・削除できるようにする（2026年10月22日）。
--
-- 【神原さん決定（2026年10月22日）】ホットペッパービューティーの SALON BOARD と同じく、
-- 店舗の owner / admin は自店の口コミに付けた返信を、投稿した後でも編集・削除できる。
--
-- 【それまでの状態】返信は管理画面（src/app/admin/reviews/page.tsx）のブラウザから
-- review_replies へ直接 INSERT していた（20260822000001 の INSERT ポリシー＋GRANT INSERT）。
-- UPDATE / DELETE は grant もポリシーも無く、review_replies は UNIQUE(review_id) なので、
-- 一度投稿した返信は二度と直せず、消せず、もう一度「返信」を押すと必ず
-- 「返信に失敗しました」になった。逃げ道は口コミそのものを非表示にすることだけだった。
--
-- 【なぜ RLS の UPDATE / DELETE ポリシーではなく、サーバーの API ＋ service_role 専用 RPC にしたか】
--   このリポジトリの管理画面の書き込みは、ほぼ全てが /api/admin/* → service_role の
--   *_atomic RPC の形になっている。一番近い機能である Q&A への店舗の回答
--   （/api/admin/qa → manage_admin_content_atomic）も、写真の削除
--   （/api/admin/photos/[id] → delete_facility_photo_atomic。ブラウザの DELETE 権は撤回済み）も
--   同じ形で、RPC の中で「今もその店舗の owner / admin か」を行ロックつきで確かめ直してから書く。
--   ブラウザ直書きのままだと次の 3 つを DB 側で守れない:
--     1. 文字数の上限（content に CHECK 制約が無く、PostgREST を直接叩けば何文字でも公開できる）
--     2. 監査ログ（誰がいつ、何を何に書き換えた／消したかが残らない）
--     3. 書き込みと同時の権限確認（権限を外された直後の書き込みを、同じトランザクションで止める）
--   返信は店舗ページに公開される文章なので、公開・書き換え・削除の 3 つを同じ経路
--   （/api/admin/review-replies）に揃え、ブラウザからの直接 INSERT は撤回する。
--   ＝新規投稿も「今日の投稿と同じ経路」で編集・削除と一貫させる。
--
-- 【切り替え時の挙動】この migration を先に適用すると、古い画面を開いたままのタブからの
--   返信投稿は「返信に失敗しました」になる（データは壊れない。再読み込みで新しい画面になる）。
--   コードを先にデプロイすると、適用までの間 RPC が無いため 500＋Slack 通知になる。
--   どちらも可視の失敗で、無音でデータが食い違うことは無い。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

-- ----------------------------------------------------------------------------
-- 1. 投稿（公開）: 自店の口コミに限り、1 口コミにつき 1 件
--    口コミが自店のものでなければ 0 行（API は 404）、既に返信があれば
--    UNIQUE(review_id) の 23505（API は 409）。
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.create_review_reply_atomic(
  p_actor_id uuid, p_facility_id uuid, p_review_id uuid, p_content text
) RETURNS TABLE(id uuid, review_id uuid, content text, created_at timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_review_id IS NULL THEN
    RAISE EXCEPTION 'REVIEW_REPLY_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_content IS NULL OR btrim(p_content) = '' OR char_length(p_content) > 500 THEN
    RAISE EXCEPTION 'REVIEW_REPLY_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM 1 FROM public.facility_members m
    WHERE m.user_id = p_actor_id AND m.facility_id = p_facility_id AND m.role IN ('owner', 'admin')
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REPLY_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.facility_reviews r
    WHERE r.id = p_review_id AND r.facility_id = p_facility_id
    FOR KEY SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
    INSERT INTO public.review_replies AS rr (review_id, user_id, content)
    VALUES (p_review_id, p_actor_id, p_content)
    RETURNING rr.id, rr.review_id, rr.content, rr.created_at;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. 編集: 自店の口コミに付いた返信だけ。書き換えるのは content だけ
--    （review_id・user_id＝最初に投稿した人・created_at は変えない）。
--    監査ログ用に書き換え前の本文も返す。
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.update_review_reply_atomic(
  p_actor_id uuid, p_facility_id uuid, p_reply_id uuid, p_content text
) RETURNS TABLE(id uuid, review_id uuid, content text, created_at timestamptz, previous_content text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_previous text;
BEGIN
  IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_reply_id IS NULL THEN
    RAISE EXCEPTION 'REVIEW_REPLY_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_content IS NULL OR btrim(p_content) = '' OR char_length(p_content) > 500 THEN
    RAISE EXCEPTION 'REVIEW_REPLY_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM 1 FROM public.facility_members m
    WHERE m.user_id = p_actor_id AND m.facility_id = p_facility_id AND m.role IN ('owner', 'admin')
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REPLY_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT rr.content INTO v_previous
    FROM public.review_replies rr
    JOIN public.facility_reviews r ON r.id = rr.review_id
    WHERE rr.id = p_reply_id AND r.facility_id = p_facility_id
    FOR UPDATE OF rr;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
    UPDATE public.review_replies AS rr SET content = p_content
    WHERE rr.id = p_reply_id
      AND EXISTS (SELECT 1 FROM public.facility_reviews r WHERE r.id = rr.review_id AND r.facility_id = p_facility_id)
    RETURNING rr.id, rr.review_id, rr.content, rr.created_at, v_previous;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. 削除: 自店の口コミに付いた返信だけ。消した本文は監査ログ用に返す。
--    店舗ページは返信をブラウザから都度読むため（ReviewList）、消した時点で表示されなくなる。
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.delete_review_reply_atomic(
  p_actor_id uuid, p_facility_id uuid, p_reply_id uuid
) RETURNS TABLE(id uuid, review_id uuid, content text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_reply_id IS NULL THEN
    RAISE EXCEPTION 'REVIEW_REPLY_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM 1 FROM public.facility_members m
    WHERE m.user_id = p_actor_id AND m.facility_id = p_facility_id AND m.role IN ('owner', 'admin')
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_REPLY_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  PERFORM 1
    FROM public.review_replies rr
    JOIN public.facility_reviews r ON r.id = rr.review_id
    WHERE rr.id = p_reply_id AND r.facility_id = p_facility_id
    FOR UPDATE OF rr;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
    DELETE FROM public.review_replies AS rr
    WHERE rr.id = p_reply_id
      AND EXISTS (SELECT 1 FROM public.facility_reviews r WHERE r.id = rr.review_id AND r.facility_id = p_facility_id)
    RETURNING rr.id, rr.review_id, rr.content;
END;
$$;

REVOKE ALL ON FUNCTION public.create_review_reply_atomic(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_review_reply_atomic(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_review_reply_atomic(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_review_reply_atomic(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_review_reply_atomic(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_review_reply_atomic(uuid, uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. ブラウザからの直接書き込みを閉じる（書き込みは上の RPC だけ）
--    公開読み取り（review_replies_public_read）はそのまま。店舗ページと管理画面は
--    引き続きブラウザから返信を読む。
--    INSERT 権を撤回したうえでポリシーも消す（どちらか片方が戻っても開かない＝二重に閉じる）。
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.review_replies FROM anon, authenticated;
DROP POLICY IF EXISTS review_replies_facility_member_insert ON public.review_replies;
