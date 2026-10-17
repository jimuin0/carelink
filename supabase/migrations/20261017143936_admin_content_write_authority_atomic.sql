-- Fixed operations and columns only; no dynamic table names or SQL from callers.
CREATE FUNCTION public.manage_admin_content_atomic(
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
    published_at=CASE WHEN p_values ? 'is_published' THEN CASE WHEN blog.is_published THEN clock_timestamp() ELSE NULL END ELSE blog.published_at END
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
