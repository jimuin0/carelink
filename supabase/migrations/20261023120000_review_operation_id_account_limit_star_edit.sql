-- 口コミの投稿・編集の 3 点を直す（2026年10月23日）。
--
-- 1. ログイン中の投稿は「同じ施設へ 24 時間に 1 件」をアカウントでも数える（lock_review_submission）
--    【問題】重複判定が reviewer_ip だけだった。ログイン中の会員が自宅の回線と携帯の回線を
--    切り替えるだけで、同じアカウントから「会員」「来店確認済み」付きの口コミを何件でも
--    重ねられ、店舗の評価（rating_avg / rating_count）を動かせた。
--    【対処】NEW.user_id があるときは、同じ施設・24 時間以内の同じ user_id も重複とみなす。
--    未ログインの投稿は従来どおり IP で判定する（アカウントが無いので数える鍵が IP しかない）。
--    同時に 2 件送られても、先頭で取る lock_booking_account（アカウント単位の advisory lock）と
--    施設行の FOR UPDATE で直列化されるので、後の 1 件は必ず先の 1 件を見てから判定する。
--    最終定義は 20261012042439_review_submission_atomic.sql（以後の再定義・動的パッチ無し）。
--    変えたのは重複判定の条件だけで、ロックの順序・例外名・SECURITY INVOKER・search_path は同じ。
--
-- 2. 星だけを直した編集で、審査済みの口コミが黙って非公開にならない（edit_review_atomic）
--    【問題】/api/review/[id] は本文が変わったかどうかを見ずに、禁止表現（「日本一」など）が
--    含まれていれば is_flagged=true を送る。運営が誤検知として承認した口コミ（is_flagged=false）を
--    投稿者が星だけ直すと、is_flagged=true に戻る。審査キューへの投入トリガ（commit_review_effects）は
--    本文が変わったときだけ動くので審査待ちにも載らず、public_reviews と評価集計
--    （update_facility_rating は is_flagged=false だけを数える）から消えたまま、誰も気づけなかった。
--    【対処】本文が変わっていない（n.comment IS NOT DISTINCT FROM r.comment）ときは、送られてきた
--    is_flagged / flag_reason を使わず、保存済みの値をそのまま残す。本文が変わったときは従来どおり
--    送られた値で旗を立て、既存トリガが content_changed の審査待ちを作る。
--    API 側で保存済みの本文と比べて旗を送らない方式にはしない。比較のための読み取りと書き込みの
--    間に別の編集が入ると、変わった本文の旗を落とし得るため。判定は行ロックの中のここで行う。
--    最終定義は 20261012042439_review_submission_atomic.sql（以後の再定義・動的パッチ無し）。
--    変えたのは UPDATE の is_flagged / flag_reason の 2 項目だけ。
--
-- 3. 送信結果が分からなかった口コミを、二重投稿なしでやり直せるようにする（client_operation_id）
--    【問題】投稿の応答が届かなかった（通信が切れた・保存の結果が不明な 500 が返った）とき、
--    投稿フォームは端末に「受付状況未確認」の印を残して投稿ボタンを止める。この印を消す手段が
--    無く、その施設の口コミ欄はその端末で永久に使えなくなっていた。
--    【対処】フォームが作る操作 ID を口コミと一緒に保存する（一意）。同じ操作 ID で送り直すと、
--    前回の口コミが保存済みならその口コミを返し（新しい口コミは作らない）、保存されていなければ
--    今回の内容を保存する。操作 ID は投稿者の端末だけが持つ乱数で、店舗には見せない
--    （列の SELECT 権限は 20261023120100 で anon / authenticated に付けない）。
--
-- 適用順: アプリのデプロイ【前】に適用する。新しいアプリは投稿時に client_operation_id を書くので、
-- この列が無いと投稿が失敗する。デプロイ前のアプリ（origin/fix/fourth-sweep-integration）は
-- この列を読み書きしないので、先に適用しても壊れない（1・2 も引数・戻り値・権限は同じ）。
-- 旧アプリでの違いは 1 つだけ: 同じアカウントの 2 件目は API の事前確認（IP だけ）を通り、
-- このトリガで REVIEW_RECENT_DUPLICATE（429「24時間に1回まで」）になる。
-- 20261023120100（列の閲覧権限）はデプロイの【後】に適用する。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

ALTER TABLE public.facility_reviews ADD COLUMN IF NOT EXISTS client_operation_id uuid;
COMMENT ON COLUMN public.facility_reviews.client_operation_id IS
  '投稿フォームが作る操作 ID（端末だけが持つ乱数）。同じ ID の送り直しを 1 件の口コミにまとめる。店舗には見せない。';
CREATE UNIQUE INDEX IF NOT EXISTS uq_facility_reviews_client_operation
  ON public.facility_reviews(client_operation_id) WHERE client_operation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.lock_review_submission() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN PERFORM public.lock_booking_account(NEW.user_id); END IF;
  PERFORM 1 FROM public.facility_profiles WHERE id=NEW.facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_FACILITY_UNAVAILABLE'; END IF;
  IF NEW.created_at >= clock_timestamp()-interval '24 hours'
    AND (nullif(NEW.reviewer_ip,'') IS NOT NULL OR NEW.user_id IS NOT NULL)
    AND EXISTS(SELECT 1 FROM public.facility_reviews r WHERE r.facility_id=NEW.facility_id
      AND r.created_at >= clock_timestamp()-interval '24 hours'
      AND ((nullif(NEW.reviewer_ip,'') IS NOT NULL AND r.reviewer_ip=NEW.reviewer_ip)
        OR (NEW.user_id IS NOT NULL AND r.user_id=NEW.user_id)))
    THEN RAISE EXCEPTION 'REVIEW_RECENT_DUPLICATE'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_review_submission() FROM PUBLIC, anon, authenticated;

-- Use the same parent -> queue -> review lock order as moderation decisions.
-- The actor is verified by the API and rechecked against the stored owner here.
CREATE OR REPLACE FUNCTION public.edit_review_atomic(p_actor_id uuid,p_review_id uuid,p_patch jsonb)
RETURNS TABLE(id uuid) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE facility uuid; r public.facility_reviews%ROWTYPE; n public.facility_reviews%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k
    WHERE k <> ALL(ARRAY['rating_skill','rating_service','rating_atmosphere','rating_cleanliness',
      'rating_explanation','comment','is_flagged','flag_reason'])) THEN RAISE EXCEPTION 'INVALID_REVIEW_PATCH'; END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  SELECT v.facility_id INTO facility FROM public.facility_reviews v WHERE v.id=p_review_id AND v.user_id=p_actor_id;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM public.facility_profiles WHERE facility_profiles.id=facility FOR UPDATE;
  PERFORM 1 FROM public.moderation_queue q WHERE q.content_type='review' AND q.content_id=p_review_id ORDER BY q.id FOR UPDATE;
  SELECT v.* INTO r FROM public.facility_reviews v WHERE v.id=p_review_id AND v.user_id=p_actor_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF r.facility_id IS DISTINCT FROM facility THEN RAISE EXCEPTION 'REVIEW_REVISION_CONFLICT'; END IF;
  n := jsonb_populate_record(r,p_patch);
  IF n.rating_skill NOT BETWEEN 1 AND 5 OR n.rating_service NOT BETWEEN 1 AND 5
    OR n.rating_atmosphere NOT BETWEEN 1 AND 5 OR n.rating_cleanliness NOT BETWEEN 1 AND 5
    OR n.rating_explanation NOT BETWEEN 1 AND 5 OR n.rating_skill IS NULL OR n.rating_service IS NULL
    OR n.rating_atmosphere IS NULL OR n.rating_cleanliness IS NULL OR n.rating_explanation IS NULL
    OR char_length(n.comment)>500 OR (p_patch ? 'is_flagged' AND n.is_flagged IS DISTINCT FROM true)
    THEN RAISE EXCEPTION 'INVALID_REVIEW_PATCH'; END IF;
  -- The moderation flag follows the text. Unchanged text keeps its stored
  -- decision (approved stays public, pending/rejected stay non-public).
  RETURN QUERY UPDATE public.facility_reviews v SET
    rating=round((n.rating_skill+n.rating_service+n.rating_atmosphere+n.rating_cleanliness+n.rating_explanation)/5.0),
    rating_skill=n.rating_skill,rating_service=n.rating_service,rating_atmosphere=n.rating_atmosphere,
    rating_cleanliness=n.rating_cleanliness,rating_explanation=n.rating_explanation,comment=n.comment,
    is_flagged=CASE WHEN n.comment IS NOT DISTINCT FROM r.comment THEN r.is_flagged ELSE n.is_flagged END,
    flag_reason=CASE WHEN n.comment IS NOT DISTINCT FROM r.comment THEN r.flag_reason ELSE n.flag_reason END
    WHERE v.id=p_review_id AND v.user_id=p_actor_id RETURNING v.id;
END;
$$;
REVOKE ALL ON FUNCTION public.edit_review_atomic(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_review_atomic(uuid,uuid,jsonb) TO service_role;
