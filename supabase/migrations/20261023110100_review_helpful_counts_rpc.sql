-- 口コミの「参考になった」件数を、押した人のアカウント ID を渡さずに返す（2026年10月23日）。
-- 2 本組の 1 本目。2 本目＝20261023110200_account_ids_hidden_from_browser.sql（コードのデプロイ後に適用）。
-- （同じ番号帯の 20261023110000 は広告枠の修正で、この 2 本とは独立）
--
-- 【それまでの状態】件数は口コミ一覧（ReviewList.tsx）がブラウザから review_helpful を直接読み、
--   ブラウザ側で数えていた。そのために review_helpful_public_count（USING true）と anon への
--   表単位の SELECT 権があり、誰でもログインなしで
--     GET /rest/v1/review_helpful?select=user_id,review_id
--   と全員の押下をアカウント ID つきで取れた（どの施設の口コミを誰が参考にしたか、が施設を
--   またいで分かる）。アカウント ID はマイページのプロフィール写真の保存先
--   （avatars/<ID>/avatar.<拡張子>・公開バケット）にもなっている。
--
-- 【この migration でやること＝追加だけ】件数を返す関数を足す。読むのは公開中の口コミ
--   （public_reviews と同じ条件：口コミが published・通報で隠されていない・施設が published）の
--   押下だけで、返すのは口コミ ID と件数だけ。全員の押下を数えるために RLS を越える必要があるので
--   SECURITY DEFINER（search_path は空に固定）。
-- 【適用順序】アプリのデプロイの前後どちらでもよい（追加だけで、旧アプリは使わない）。
--   新アプリはこの関数で件数を読むので、デプロイより先に適用しておくと件数が途切れない
--   （後になった場合は、適用までの間だけ件数が 0 と表示される。本番の口コミは今 0 件）。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

CREATE OR REPLACE FUNCTION public.get_review_helpful_counts(p_review_ids uuid[])
RETURNS TABLE(review_id uuid, helpful_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT h.review_id, count(*)::integer
  FROM public.review_helpful h
  JOIN public.facility_reviews r ON r.id = h.review_id
  JOIN public.facility_profiles f ON f.id = r.facility_id
  WHERE h.review_id = ANY (p_review_ids)
    AND r.status = 'published'
    AND r.is_flagged = false
    AND f.status = 'published'
  GROUP BY h.review_id
$$;

REVOKE ALL ON FUNCTION public.get_review_helpful_counts(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_review_helpful_counts(uuid[]) TO anon, authenticated, service_role;
