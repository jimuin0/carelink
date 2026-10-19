CREATE FUNCTION public.manage_platform_editor_atomic(p_actor_id uuid,p_record_id uuid,p_kind text,p_values jsonb,p_expected_image_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE allowed text[]; result jsonb; f public.feature_articles%ROWTYPE; b public.platform_blog_posts%ROWTYPE; n public.newsletter_campaigns%ROWTYPE;
BEGIN
 allowed=CASE p_kind
 WHEN 'feature:create' THEN ARRAY['title','subtitle','image_url','href','is_active','sort_order']
 WHEN 'feature:update' THEN ARRAY['title','subtitle','image_url','href','is_active','sort_order']
 WHEN 'post:create' THEN ARRAY['slug','title','description','category','tags','reading_time','content','is_published']
 WHEN 'post:update' THEN ARRAY['slug','title','description','category','tags','reading_time','content','is_published']
 WHEN 'newsletter:create' THEN ARRAY['campaign_type','subject','html_content','text_content']
 WHEN 'feature:delete' THEN ARRAY[]::text[] WHEN 'post:delete' THEN ARRAY[]::text[] WHEN 'newsletter:cancel' THEN ARRAY[]::text[] ELSE NULL END;
 IF allowed IS NULL OR p_values IS NULL OR jsonb_typeof(p_values)<>'object' OR p_values-allowed<>'{}'::jsonb
  OR (p_expected_image_url IS NOT NULL AND p_kind<>'feature:update') OR (p_kind LIKE '%:create' AND p_record_id IS NOT NULL) OR (p_kind NOT LIKE '%:create' AND p_record_id IS NULL)
  OR (p_values='{}'::jsonb AND p_kind NOT IN ('feature:delete','post:delete','newsletter:cancel'))
 THEN RAISE EXCEPTION 'INVALID_PLATFORM_EDITOR' USING ERRCODE='22023'; END IF;
 BEGIN PERFORM public.lock_booking_account(p_actor_id);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='BOOKING_ACCOUNT_UNAVAILABLE' THEN RAISE EXCEPTION 'PLATFORM_EDITOR_FORBIDDEN' USING ERRCODE='42501'; ELSE RAISE; END IF;
 END;
 PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND is_platform_admin IS TRUE FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PLATFORM_EDITOR_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_kind LIKE 'feature:%' THEN
  IF p_kind<>'feature:create' THEN
   SELECT * INTO f FROM public.feature_articles WHERE id=p_record_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'PLATFORM_EDITOR_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  END IF;
  IF p_expected_image_url IS NOT NULL AND (p_kind<>'feature:update' OR f.image_url IS DISTINCT FROM p_expected_image_url OR p_values->>'image_url' IS DISTINCT FROM p_expected_image_url)
  THEN RAISE EXCEPTION 'FEATURE_IMAGE_CHANGED' USING ERRCODE='40001'; END IF;
  IF p_kind='feature:delete' THEN
   DELETE FROM public.feature_articles WHERE id=p_record_id RETURNING to_jsonb(feature_articles.*) INTO result;
  ELSE
   IF (p_values ? 'sort_order' AND CASE WHEN jsonb_typeof(p_values->'sort_order')='number' THEN trunc((p_values->>'sort_order')::numeric)<>(p_values->>'sort_order')::numeric OR (p_values->>'sort_order')::numeric NOT BETWEEN 0 AND 9999 ELSE true END) OR (p_values ? 'title' AND jsonb_typeof(p_values->'title') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'INVALID_PLATFORM_EDITOR' USING ERRCODE='22023'; END IF;
   SELECT * INTO f FROM jsonb_populate_record(f,p_values);
   IF f.title IS NULL OR char_length(f.title) NOT BETWEEN 1 AND 200 OR char_length(f.subtitle)>300
    OR (p_values ? 'is_active' AND jsonb_typeof(p_values->'is_active') IS DISTINCT FROM 'boolean')
    OR (p_values ? 'sort_order' AND (jsonb_typeof(p_values->'sort_order') IS DISTINCT FROM 'number' OR f.sort_order NOT BETWEEN 0 AND 9999))
   THEN RAISE EXCEPTION 'INVALID_PLATFORM_EDITOR' USING ERRCODE='22023'; END IF;
   IF p_kind='feature:create' THEN
    INSERT INTO public.feature_articles(title,subtitle,image_url,href,is_active,sort_order) VALUES(f.title,f.subtitle,f.image_url,coalesce(f.href,''),coalesce(f.is_active,true),coalesce(f.sort_order,0)) RETURNING to_jsonb(feature_articles.*) INTO result;
   ELSE
    UPDATE public.feature_articles SET title=f.title,subtitle=f.subtitle,image_url=f.image_url,href=f.href,is_active=f.is_active,sort_order=f.sort_order WHERE id=p_record_id RETURNING to_jsonb(feature_articles.*) INTO result;
   END IF;
  END IF;
 ELSIF p_kind LIKE 'post:%' THEN
  IF p_kind<>'post:create' THEN
   SELECT * INTO b FROM public.platform_blog_posts WHERE id=p_record_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'PLATFORM_EDITOR_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  END IF;
  IF p_kind='post:delete' THEN
   DELETE FROM public.platform_blog_posts WHERE id=p_record_id RETURNING to_jsonb(platform_blog_posts.*) INTO result;
  ELSE
   IF (p_values ? 'reading_time' AND CASE WHEN jsonb_typeof(p_values->'reading_time')='number' THEN trunc((p_values->>'reading_time')::numeric)<>(p_values->>'reading_time')::numeric OR (p_values->>'reading_time')::numeric NOT BETWEEN 1 AND 999 ELSE true END) OR (p_values ? 'title' AND jsonb_typeof(p_values->'title') IS DISTINCT FROM 'string') OR (p_values ? 'slug' AND jsonb_typeof(p_values->'slug') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'INVALID_PLATFORM_EDITOR' USING ERRCODE='22023'; END IF;
   SELECT * INTO b FROM jsonb_populate_record(b,p_values);
   IF b.title IS NULL OR char_length(b.title) NOT BETWEEN 1 AND 200 OR b.slug IS NULL OR char_length(b.slug) NOT BETWEEN 1 AND 200 OR b.slug !~ '^[a-z0-9-]+$'
    OR char_length(b.description)>500 OR char_length(b.category)>50
    OR (p_values ? 'is_published' AND jsonb_typeof(p_values->'is_published') IS DISTINCT FROM 'boolean')
    OR (p_values ? 'reading_time' AND (jsonb_typeof(p_values->'reading_time') IS DISTINCT FROM 'number' OR b.reading_time NOT BETWEEN 1 AND 999))
    OR (p_values ? 'content' AND jsonb_typeof(p_values->'content') IS DISTINCT FROM 'array')
   THEN RAISE EXCEPTION 'INVALID_PLATFORM_EDITOR' USING ERRCODE='22023'; END IF;
   IF p_kind='post:create' THEN
    INSERT INTO public.platform_blog_posts(slug,title,description,category,tags,reading_time,content,is_published,published_at)
     VALUES(b.slug,b.title,coalesce(b.description,''),coalesce(b.category,''),coalesce(b.tags,ARRAY[]::text[]),coalesce(b.reading_time,5),coalesce(b.content,'[]'::jsonb),coalesce(b.is_published,false),CASE WHEN b.is_published THEN clock_timestamp() ELSE NULL END) RETURNING to_jsonb(platform_blog_posts.*) INTO result;
   ELSE
    UPDATE public.platform_blog_posts SET slug=b.slug,title=b.title,description=b.description,category=b.category,tags=b.tags,reading_time=b.reading_time,content=b.content,is_published=b.is_published,
     published_at=CASE WHEN p_values ? 'is_published' THEN CASE WHEN b.is_published THEN clock_timestamp() ELSE NULL END ELSE b.published_at END,updated_at=clock_timestamp() WHERE id=p_record_id RETURNING to_jsonb(platform_blog_posts.*) INTO result;
   END IF;
  END IF;
 ELSE
  IF p_kind='newsletter:create' THEN
   SELECT * INTO n FROM jsonb_populate_record(NULL::public.newsletter_campaigns,p_values);
   IF n.campaign_type IS NULL OR n.campaign_type NOT IN ('owner_monthly','user_digest','user_coupon','promo')
    OR n.subject IS NULL OR char_length(n.subject) NOT BETWEEN 1 AND 200 OR n.html_content IS NULL OR char_length(n.html_content) NOT BETWEEN 1 AND 100000 OR char_length(n.text_content)>100000
   THEN RAISE EXCEPTION 'INVALID_PLATFORM_EDITOR' USING ERRCODE='22023'; END IF;
   INSERT INTO public.newsletter_campaigns(campaign_type,subject,html_content,text_content,scheduled_at,status,created_by) VALUES(n.campaign_type,n.subject,n.html_content,n.text_content,NULL,'draft',p_actor_id) RETURNING to_jsonb(newsletter_campaigns.*) INTO result;
  ELSE
   SELECT * INTO n FROM public.newsletter_campaigns WHERE id=p_record_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'NEWSLETTER_STATE_CHANGED' USING ERRCODE='40001'; END IF;
   IF n.status<>'scheduled' THEN RAISE EXCEPTION 'NEWSLETTER_STATE_CHANGED' USING ERRCODE='40001'; END IF;
   UPDATE public.newsletter_campaigns SET status='cancelled',updated_at=clock_timestamp() WHERE id=p_record_id RETURNING to_jsonb(newsletter_campaigns.*) INTO result;
  END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.manage_platform_editor_atomic(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_platform_editor_atomic(uuid,uuid,text,jsonb,text) TO service_role;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.feature_articles,public.platform_blog_posts,public.newsletter_campaigns FROM PUBLIC,anon,authenticated;
