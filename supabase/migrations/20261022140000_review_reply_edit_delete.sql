-- 口コミへの返信を、投稿後に編集・削除できるようにする（2026年10月22日）。
-- 2 本組の 1 本目（追加だけ）。2 本目＝20261022140100_review_reply_close_browser_writes.sql。
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
--   （/api/admin/review-replies）に揃える。
--   ＝新規投稿も「今日の投稿と同じ経路」で編集・削除と一貫させる。
--
-- 【なぜ 2 本に分けたか（本番の切り替えで投稿が壊れる窓を作らない）】
--   本番はコードが Vercel へ自動デプロイされ、migration は手で適用する＝両者のタイミングは揃わない。
--   「RPC の追加」と「ブラウザの書き込み権の撤回」を 1 本にすると、どちらを先にしても返信の投稿が
--   壊れる時間ができる（migration が先なら旧画面のブラウザ INSERT が失敗し、コードが先なら RPC が
--   無くて 500）。そこで:
--     1 本目（この migration）… RPC を足すだけ。既存の権限・ポリシーには一切触れないので、
--                               旧コード（ブラウザ INSERT）はそのまま動く。
--     2 本目（20261022140100）… ブラウザの書き込み権と INSERT ポリシーを撤回する。
--   本番の順序: ① この migration を適用 → ② コードをデプロイ（マージ）→ ③ 2 本目を適用。

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
