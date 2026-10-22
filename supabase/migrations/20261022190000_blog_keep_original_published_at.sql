DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

-- 公開済みの記事を保存し直しても、公開日（published_at）を変えない（2026年10月22日）。
--
-- 【不具合】運営のコラム（platform_blog_posts）も店舗ブログ（blog_posts）も、編集画面は
-- 保存のたびに is_published を必ず送る。2 つの RPC は「is_published が送られて true なら
-- published_at = clock_timestamp()」としていたため、公開中の記事の誤字を直して保存するだけで
-- 公開日が保存した日に変わり、/blog・店舗ブログ一覧（published_at の降順）の先頭へ移り、
-- 記事ページの公開日と JSON-LD の datePublished も保存日になっていた。
--
-- 【直し方】UPDATE の SET 式の中では、列名は「更新前の行」の値を指す
-- （jsonb_populate_record で上書きした record 変数 b / blog とは別物）。これを使い、
--   - もともと公開中（更新前 is_published IS TRUE）のまま保存 … 元の published_at を保つ
--     （旧データで公開中なのに published_at が NULL の行だけは、この時刻を入れる）
--   - 非公開から公開へ                                      … この時刻を入れる（初回公開。
--                                                             公開を取り消してから再公開したときも、その時刻）
--   - 公開を取り消す                                        … NULL（従来どおり）
--   - is_published を送らない保存                           … 触らない（従来どおり）
-- とする。新規作成（:create）の式は変えていない。
--
-- 【変えていないもの】関数のシグネチャ・引数・戻り値・SECURITY INVOKER・SET search_path・
-- 権限確認・ロック順・検証条件・他の kind（catalog / qa / job / feature / newsletter）は
-- 20261017143936 / 20261019023252 の最終定義と一字一句同じ（src/__tests__/blog-published-at-preserved.test.ts
-- が published_at の式以外に差が無いことを機械で確かめる）。
--
-- 【適用順序】アプリのデプロイの前後どちらに適用してもよい。RPC の呼び方は変わらず、
-- 旧アプリのまま適用しても「公開日が変わらなくなる」だけ。
-- 適用後は schema-fingerprint の期待値（関数の body_md5）が変わるので、CI の成果物から再生成する。

-- ----------------------------------------------------------------------------
-- 1. 店舗ブログ（blog:update）。最終定義＝20261017143936_admin_content_write_authority_atomic.sql
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manage_admin_content_atomic(
 p_actor_id uuid,p_facility_id uuid,p_record_id uuid,p_kind text,p_values jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE allowed text[]; result jsonb;
 catalog public.treatment_catalogs%ROWTYPE; blog public.blog_posts%ROWTYPE;
 qa public.facility_qa%ROWTYPE; job public.facility_jobs%ROWTYPE;
BEGIN
 IF p_actor_id IS NULL OR p_facility_id IS NULL THEN RAISE EXCEPTION 'CONTENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 allowed:=CASE p_kind
  WHEN 'catalog:create' THEN ARRAY['title','description','tags']
  WHEN 'catalog:update' THEN ARRAY['title','description','tags']
  WHEN 'catalog:delete' THEN ARRAY[]::text[]
  WHEN 'blog:create' THEN ARRAY['title','slug','content','is_published']
  WHEN 'blog:update' THEN ARRAY['title','content','is_published']
  WHEN 'blog:delete' THEN ARRAY[]::text[]
  WHEN 'qa:answer' THEN ARRAY['answer']
  WHEN 'qa:toggle' THEN ARRAY['is_public']
  WHEN 'qa:delete' THEN ARRAY[]::text[]
  WHEN 'job:create' THEN ARRAY['title','job_type','employment_type','salary_min','salary_max','salary_note','description','requirements','benefits']
  WHEN 'job:update' THEN ARRAY['title','job_type','employment_type','salary_min','salary_max','salary_note','description','requirements','benefits']
  WHEN 'job:delete' THEN ARRAY[]::text[]
  ELSE NULL END;
 IF allowed IS NULL OR p_values IS NULL OR jsonb_typeof(p_values)<>'object' OR p_values-allowed<>'{}'::jsonb
  OR (p_kind LIKE '%:create' AND p_record_id IS NOT NULL)
  OR (p_kind NOT LIKE '%:create' AND p_record_id IS NULL)
 THEN RAISE EXCEPTION 'INVALID_CONTENT_MUTATION' USING ERRCODE='22023'; END IF;
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.facility_members WHERE user_id=p_actor_id AND facility_id=p_facility_id AND role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.facility_profiles WHERE id=p_facility_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 CASE
 WHEN p_kind='catalog:create' THEN
  SELECT * INTO catalog FROM jsonb_populate_record(NULL::public.treatment_catalogs,p_values);
  IF catalog.title IS NULL OR char_length(catalog.title) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_CONTENT_MUTATION' USING ERRCODE='22023'; END IF;
  INSERT INTO public.treatment_catalogs(facility_id,title,description,tags) VALUES(p_facility_id,catalog.title,catalog.description,catalog.tags) RETURNING to_jsonb(treatment_catalogs.*) INTO result;
 WHEN p_kind IN ('catalog:update','catalog:delete') THEN
  SELECT * INTO catalog FROM public.treatment_catalogs WHERE id=p_record_id AND facility_id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_kind='catalog:delete' THEN
   DELETE FROM public.treatment_catalogs WHERE id=p_record_id AND facility_id=p_facility_id RETURNING to_jsonb(treatment_catalogs.*) INTO result;
  ELSE
   SELECT * INTO catalog FROM jsonb_populate_record(catalog,p_values);
   IF catalog.title IS NULL OR char_length(catalog.title) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_CONTENT_MUTATION' USING ERRCODE='22023'; END IF;
   UPDATE public.treatment_catalogs SET title=catalog.title,description=catalog.description,tags=catalog.tags WHERE id=p_record_id AND facility_id=p_facility_id RETURNING to_jsonb(treatment_catalogs.*) INTO result;
  END IF;
 WHEN p_kind='blog:create' THEN
  SELECT * INTO blog FROM jsonb_populate_record(NULL::public.blog_posts,p_values);
  IF blog.title IS NULL OR char_length(blog.title) NOT BETWEEN 1 AND 200 OR blog.content IS NULL OR char_length(blog.content) NOT BETWEEN 1 AND 50000 OR blog.slug IS NULL OR blog.slug='' THEN RAISE EXCEPTION 'INVALID_CONTENT_MUTATION' USING ERRCODE='22023'; END IF;
  INSERT INTO public.blog_posts(facility_id,title,slug,content,is_published,published_at)
   VALUES(p_facility_id,blog.title,blog.slug,blog.content,COALESCE(blog.is_published,false),CASE WHEN blog.is_published THEN clock_timestamp() ELSE NULL END) RETURNING to_jsonb(blog_posts.*) INTO result;
 WHEN p_kind IN ('blog:update','blog:delete') THEN
  SELECT * INTO blog FROM public.blog_posts WHERE id=p_record_id AND facility_id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_kind='blog:delete' THEN
   DELETE FROM public.blog_posts WHERE id=p_record_id AND facility_id=p_facility_id RETURNING to_jsonb(blog_posts.*) INTO result;
  ELSE
   SELECT * INTO blog FROM jsonb_populate_record(blog,p_values);
   IF blog.title IS NULL OR char_length(blog.title) NOT BETWEEN 1 AND 200 OR blog.content IS NULL OR char_length(blog.content) NOT BETWEEN 1 AND 50000 OR (p_values ? 'is_published' AND blog.is_published IS NULL) THEN RAISE EXCEPTION 'INVALID_CONTENT_MUTATION' USING ERRCODE='22023'; END IF;
   UPDATE public.blog_posts SET title=blog.title,content=blog.content,is_published=blog.is_published,
    published_at=CASE WHEN p_values ? 'is_published' THEN CASE WHEN blog.is_published THEN CASE WHEN blog_posts.is_published IS TRUE THEN coalesce(blog_posts.published_at,clock_timestamp()) ELSE clock_timestamp() END ELSE NULL END ELSE blog.published_at END
    WHERE id=p_record_id AND facility_id=p_facility_id RETURNING to_jsonb(blog_posts.*) INTO result;
  END IF;
 WHEN p_kind IN ('qa:answer','qa:toggle','qa:delete') THEN
  SELECT * INTO qa FROM public.facility_qa WHERE id=p_record_id AND facility_id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_kind='qa:delete' THEN
   DELETE FROM public.facility_qa WHERE id=p_record_id AND facility_id=p_facility_id RETURNING to_jsonb(facility_qa.*) INTO result;
  ELSIF p_kind='qa:answer' THEN
   IF jsonb_typeof(p_values->'answer') IS DISTINCT FROM 'string' OR char_length(p_values->>'answer') NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'INVALID_CONTENT_MUTATION' USING ERRCODE='22023'; END IF;
   UPDATE public.facility_qa SET answer=p_values->>'answer',answered_by=p_actor_id,answered_at=clock_timestamp(),status='answered'
    WHERE id=p_record_id AND facility_id=p_facility_id RETURNING to_jsonb(facility_qa.*) INTO result;
  ELSE
   IF jsonb_typeof(p_values->'is_public') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'INVALID_CONTENT_MUTATION' USING ERRCODE='22023'; END IF;
   UPDATE public.facility_qa SET is_public=(p_values->>'is_public')::boolean WHERE id=p_record_id AND facility_id=p_facility_id RETURNING to_jsonb(facility_qa.*) INTO result;
  END IF;
 WHEN p_kind='job:create' THEN
  SELECT * INTO job FROM jsonb_populate_record(NULL::public.facility_jobs,p_values);
  IF job.title IS NULL OR char_length(job.title) NOT BETWEEN 1 AND 120 OR job.job_type IS NULL OR char_length(job.job_type) NOT BETWEEN 1 AND 60 OR job.employment_type NOT IN ('正社員','契約社員','アルバイト・パート','業務委託','派遣') OR job.employment_type IS NULL THEN RAISE EXCEPTION 'INVALID_CONTENT_MUTATION' USING ERRCODE='22023'; END IF;
  INSERT INTO public.facility_jobs(facility_id,title,job_type,employment_type,salary_min,salary_max,salary_note,description,requirements,benefits)
   VALUES(p_facility_id,job.title,job.job_type,job.employment_type,job.salary_min,job.salary_max,job.salary_note,job.description,job.requirements,job.benefits) RETURNING to_jsonb(facility_jobs.*) INTO result;
 WHEN p_kind IN ('job:update','job:delete') THEN
  SELECT * INTO job FROM public.facility_jobs WHERE id=p_record_id AND facility_id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_kind='job:delete' THEN
   DELETE FROM public.facility_jobs WHERE id=p_record_id AND facility_id=p_facility_id RETURNING to_jsonb(facility_jobs.*) INTO result;
  ELSE
   SELECT * INTO job FROM jsonb_populate_record(job,p_values);
   IF job.title IS NULL OR char_length(job.title) NOT BETWEEN 1 AND 120 OR job.job_type IS NULL OR char_length(job.job_type) NOT BETWEEN 1 AND 60 OR job.employment_type NOT IN ('正社員','契約社員','アルバイト・パート','業務委託','派遣') OR job.employment_type IS NULL THEN RAISE EXCEPTION 'INVALID_CONTENT_MUTATION' USING ERRCODE='22023'; END IF;
   UPDATE public.facility_jobs SET title=job.title,job_type=job.job_type,employment_type=job.employment_type,
    salary_min=job.salary_min,salary_max=job.salary_max,salary_note=job.salary_note,description=job.description,requirements=job.requirements,benefits=job.benefits,updated_at=clock_timestamp()
    WHERE id=p_record_id AND facility_id=p_facility_id RETURNING to_jsonb(facility_jobs.*) INTO result;
  END IF;
 END CASE;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.manage_admin_content_atomic(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_admin_content_atomic(uuid,uuid,uuid,text,jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. 運営のコラム（post:update）。最終定義＝20261019023252_platform_editor_write_atomic.sql
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.manage_platform_editor_atomic(p_actor_id uuid,p_record_id uuid,p_kind text,p_values jsonb,p_expected_image_url text DEFAULT NULL)
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
     published_at=CASE WHEN p_values ? 'is_published' THEN CASE WHEN b.is_published THEN CASE WHEN platform_blog_posts.is_published IS TRUE THEN coalesce(platform_blog_posts.published_at,clock_timestamp()) ELSE clock_timestamp() END ELSE NULL END ELSE b.published_at END,updated_at=clock_timestamp() WHERE id=p_record_id RETURNING to_jsonb(platform_blog_posts.*) INTO result;
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
