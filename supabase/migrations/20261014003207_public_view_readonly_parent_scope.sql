-- Public cards can use the existing underlying public RLS policies.
CREATE OR REPLACE VIEW public.facility_card_view WITH (security_invoker=true,security_barrier=true) AS
 SELECT fp.id,fp.slug,fp.name,fp.business_type,fp.catch_copy,fp.description,fp.prefecture,fp.city,fp.access_info,
 fp.rating_avg,fp.rating_count,fp.main_photo_url,fp.business_hours,fp.seat_count,fp.status,fp.latitude,fp.longitude,
 fp.features,fp.created_at,menu_agg.min_price,menu_agg.max_price,coalesce(menu_agg.menu_count,0) AS menu_count,
 coalesce(coupon_agg.coupon_count,0) AS coupon_count,coalesce(photo_agg.photo_count,0) AS photo_count,
 fp.google_rating,fp.google_review_count,fp.nearest_station
 FROM public.facility_profiles fp
 LEFT JOIN LATERAL (
  SELECT min(m.price) AS min_price,max(m.price) AS max_price,count(*)::integer AS menu_count
  FROM public.facility_menus m WHERE m.facility_id=fp.id AND m.price IS NOT NULL AND coalesce(m.is_published,true)
 ) menu_agg ON true
 LEFT JOIN LATERAL (
  SELECT count(*)::integer AS coupon_count FROM public.coupons c
  WHERE c.facility_id=fp.id AND c.is_active=true
   AND (c.valid_from IS NULL OR c.valid_from<=(now() AT TIME ZONE 'Asia/Tokyo')::date)
   AND (c.valid_until IS NULL OR c.valid_until>=(now() AT TIME ZONE 'Asia/Tokyo')::date)
 ) coupon_agg ON true
 LEFT JOIN LATERAL (
  SELECT count(*)::integer AS photo_count FROM public.facility_photos p WHERE p.facility_id=fp.id
 ) photo_agg ON true
 WHERE fp.status='published';

-- Reviews contain private author identifiers/IPs and private owner/author reads.
-- Keep the existing restricted public projection: adding public SELECT to the
-- base table would expose private columns to existing authenticated readers.
-- The barrier and parent predicate protect this read-only publication boundary.
CREATE OR REPLACE VIEW public.public_reviews WITH (security_invoker=false,security_barrier=true) AS
 SELECT r.id,r.facility_id,r.reviewer_name,r.rating,r.rating_skill,r.rating_service,r.rating_atmosphere,
 r.rating_cleanliness,r.rating_explanation,r.comment,r.photo_urls,r.is_verified_visit,r.status,r.created_at
 FROM public.facility_reviews r JOIN public.facility_profiles f ON f.id=r.facility_id
 WHERE r.status='published' AND r.is_flagged=false AND f.status='published';
REVOKE ALL ON public.facility_card_view,public.public_reviews FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.facility_card_view,public.public_reviews TO anon,authenticated,service_role;

DROP POLICY IF EXISTS coupons_public_read ON public.coupons;
CREATE POLICY coupons_public_read ON public.coupons FOR SELECT TO anon,authenticated
 USING (is_active=true
  AND (valid_from IS NULL OR valid_from<=(now() AT TIME ZONE 'Asia/Tokyo')::date)
  AND (valid_until IS NULL OR valid_until>=(now() AT TIME ZONE 'Asia/Tokyo')::date)
  AND EXISTS(SELECT 1 FROM public.facility_profiles f WHERE f.id=coupons.facility_id AND f.status='published'));
CREATE POLICY coupons_owner_read ON public.coupons FOR SELECT TO authenticated
 USING (EXISTS(SELECT 1 FROM public.facility_members m WHERE m.facility_id=coupons.facility_id
  AND m.user_id=(SELECT auth.uid()) AND m.role IN ('owner','admin')));
DROP POLICY IF EXISTS coupon_menus_public_read ON public.coupon_menus;
-- Preserve the historical policy name so the legacy combined replay does not
-- recreate its former unrestricted policy after this migration.
CREATE POLICY coupon_menus_public_read ON public.coupon_menus FOR SELECT TO anon,authenticated
 USING (EXISTS(SELECT 1 FROM public.coupons c WHERE c.id=coupon_menus.coupon_id));

DROP POLICY IF EXISTS "Public read menus" ON public.facility_menus;
CREATE POLICY "Public read menus" ON public.facility_menus FOR SELECT TO anon
 USING (coalesce(is_published,true) AND EXISTS(
  SELECT 1 FROM public.facility_profiles f WHERE f.id=facility_menus.facility_id AND f.status='published'));
DROP POLICY IF EXISTS auth_read_menus ON public.facility_menus;
CREATE POLICY auth_read_menus ON public.facility_menus FOR SELECT TO authenticated
 USING ((coalesce(is_published,true) AND EXISTS(
  SELECT 1 FROM public.facility_profiles f WHERE f.id=facility_menus.facility_id AND f.status='published'))
  OR EXISTS(SELECT 1 FROM public.facility_members m WHERE m.facility_id=facility_menus.facility_id
   AND m.user_id=(SELECT auth.uid())));
