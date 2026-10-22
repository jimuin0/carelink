-- 口コミ一覧の「会員」バッジ用に public_reviews へ is_member を追加する（2026年10月22日）。
--
-- 【神原さん決定（2026年10月22日）】口コミの投稿者名は、投稿フォームに本人が入力した名前
-- （ニックネーム可）をそのまま公開する。以前はログイン済みユーザーの入力を
-- profiles.display_name（多くは本名）で黙って置き換えており、「ニックネーム可」と案内した欄の
-- 名前ではなく登録名が公開されていた。
--
-- なりすまし対策は名前の置き換えではなく表示で行う。アカウントに紐づく投稿（user_id あり）を
-- 「会員」として区別できるよう、真偽値だけを公開する。user_id 自体は公開しない。
--
-- public_reviews は列を絞るための公開ビュー（security_invoker=false + security_barrier=true）。
-- この性質は変えない。既存の列は順序・型ともそのままにし、is_member を末尾に足す
-- （CREATE OR REPLACE VIEW は末尾への列追加だけを許す）。GRANT も同じ内容で再設定する。

DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

CREATE OR REPLACE VIEW public.public_reviews WITH (security_invoker=false,security_barrier=true) AS
 SELECT r.id,r.facility_id,r.reviewer_name,r.rating,r.rating_skill,r.rating_service,r.rating_atmosphere,
 r.rating_cleanliness,r.rating_explanation,r.comment,r.photo_urls,r.is_verified_visit,r.status,r.created_at,
 (r.user_id IS NOT NULL) AS is_member
 FROM public.facility_reviews r JOIN public.facility_profiles f ON f.id=r.facility_id
 WHERE r.status='published' AND r.is_flagged=false AND f.status='published';

REVOKE ALL ON public.public_reviews FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.public_reviews TO anon,authenticated,service_role;
