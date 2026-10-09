-- Preserve stricter/private bucket configuration; never rewrite existing objects.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='review-photos' AND allowed_mime_types IS NOT NULL
   AND NOT (allowed_mime_types && ARRAY['image/jpeg','image/png','image/webp'])) THEN
  RAISE EXCEPTION 'REVIEW_BUCKET_MIME_RECONCILIATION_REQUIRED';
 END IF;
END $$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('review-photos','review-photos',true,5242880,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO UPDATE SET file_size_limit=LEAST(COALESCE(storage.buckets.file_size_limit,5242880),5242880),
 allowed_mime_types=CASE WHEN storage.buckets.allowed_mime_types IS NULL THEN ARRAY['image/jpeg','image/png','image/webp']
 ELSE ARRAY(SELECT m FROM unnest(storage.buckets.allowed_mime_types) m WHERE m IN ('image/jpeg','image/png','image/webp')) END;

-- A claim is not publication. The creation ID and start fence must commit before
-- the external public POST. Old claims without evidence remain held, never reset
-- merely because they are old. No old rows/posts are physically deleted here.
ALTER TABLE public.platform_blog_posts
 ADD COLUMN threads_delivery_attempt_id uuid,
 ADD COLUMN threads_delivery_started_at timestamptz,
 ADD COLUMN threads_creation_id text,
 ADD COLUMN threads_post_status text,
 ADD COLUMN threads_last_error text;
ALTER TABLE public.platform_blog_posts ADD CONSTRAINT platform_blog_threads_status_check
 CHECK(threads_post_status IS NULL OR threads_post_status IN ('claimed','started','published','permanent','ambiguous'));
ALTER TABLE public.platform_blog_posts ADD CONSTRAINT platform_blog_threads_start_check
 CHECK(threads_delivery_started_at IS NULL OR (threads_delivery_attempt_id IS NOT NULL AND threads_creation_id IS NOT NULL));

CREATE FUNCTION public.claim_threads_article(p_post_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.platform_blog_posts%ROWTYPE; attempt uuid;
BEGIN
 SELECT * INTO p FROM public.platform_blog_posts WHERE id=p_post_id FOR UPDATE;
 IF NOT FOUND OR p.is_published IS DISTINCT FROM true OR p.threads_post_id IS NOT NULL OR p.threads_delivery_started_at IS NOT NULL
   OR p.threads_post_status IN ('published','ambiguous') THEN RETURN NULL; END IF;
 IF p.threads_posted_at IS NOT NULL AND (p.threads_post_status IS NULL
   OR p.threads_posted_at > clock_timestamp()-interval '4 hours') THEN RETURN NULL; END IF;
 attempt:=pg_catalog.gen_random_uuid();
 UPDATE public.platform_blog_posts SET threads_delivery_attempt_id=attempt, threads_posted_at=clock_timestamp(),
   threads_post_status='claimed',threads_last_error=NULL,threads_creation_id=NULL WHERE id=p_post_id;
 RETURN jsonb_build_object('attemptId',attempt,'title',p.title,'slug',p.slug);
END $$;
CREATE FUNCTION public.start_threads_article_publish(p_post_id uuid,p_attempt_id uuid,p_creation_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_creation_id IS NULL OR p_creation_id !~ '^[0-9]{1,100}$' THEN RAISE EXCEPTION 'INVALID_THREADS_CREATION_ID'; END IF;
 UPDATE public.platform_blog_posts SET threads_delivery_started_at=clock_timestamp(),threads_creation_id=p_creation_id,
   threads_post_status='started' WHERE id=p_post_id AND threads_delivery_attempt_id=p_attempt_id
   AND threads_post_status='claimed' AND threads_delivery_started_at IS NULL AND threads_post_id IS NULL AND is_published;
 RETURN FOUND;
END $$;
CREATE FUNCTION public.finish_threads_article_publish(p_post_id uuid,p_attempt_id uuid,p_outcome text,p_post_id_external text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.platform_blog_posts%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.platform_blog_posts WHERE id=p_post_id FOR UPDATE;
 IF NOT FOUND OR p.threads_delivery_attempt_id IS DISTINCT FROM p_attempt_id THEN RETURN 'conflict'; END IF;
 IF p.threads_post_status='published' THEN
  IF p_outcome='published' AND p.threads_post_id IS NOT DISTINCT FROM p_post_id_external THEN RETURN 'published'; END IF;
  RETURN 'conflict';
 END IF;
 IF p_outcome='published' AND p_post_id_external ~ '^[0-9]{1,100}$' AND p.threads_delivery_started_at IS NOT NULL THEN
  UPDATE public.platform_blog_posts SET threads_post_id=p_post_id_external,threads_post_status='published',threads_last_error=NULL WHERE id=p_post_id;
  RETURN 'published';
 END IF;
 IF p_outcome='unknown' OR p.threads_delivery_started_at IS NOT NULL THEN
  UPDATE public.platform_blog_posts SET threads_post_status='ambiguous',threads_last_error='PUBLICATION_RESULT_UNCONFIRMED' WHERE id=p_post_id;
  RETURN 'ambiguous';
 END IF;
 IF p_outcome='permanent' THEN
  UPDATE public.platform_blog_posts SET threads_post_status='permanent',threads_last_error='PREPUBLICATION_REJECTED' WHERE id=p_post_id;
  RETURN 'permanent';
 END IF;
 IF p_outcome IN ('skipped','transient') THEN
  UPDATE public.platform_blog_posts SET threads_posted_at=NULL,threads_delivery_attempt_id=NULL,
   threads_post_status=NULL,threads_creation_id=NULL,threads_last_error=NULL WHERE id=p_post_id;
  RETURN p_outcome;
 END IF;
 RAISE EXCEPTION 'INVALID_THREADS_OUTCOME';
END $$;
-- Verified provider PUBLISHED status proves publication even if the public post
-- ID was lost. Keep that ID unknown; a creation ID must never impersonate it.
-- Other provider states are observed but never authorize automatic republishing.
CREATE FUNCTION public.reconcile_threads_article_publish(p_post_id uuid,p_attempt_id uuid,p_creation_id text,p_provider_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_provider_status<>'PUBLISHED' THEN RETURN false; END IF;
 UPDATE public.platform_blog_posts SET threads_post_status='published',threads_last_error=NULL
 WHERE id=p_post_id AND threads_delivery_attempt_id=p_attempt_id AND threads_creation_id=p_creation_id
 AND threads_delivery_started_at IS NOT NULL AND threads_post_status IN ('started','ambiguous','published');
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_threads_article(uuid),public.start_threads_article_publish(uuid,uuid,text),
 public.finish_threads_article_publish(uuid,uuid,text,text),public.reconcile_threads_article_publish(uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_threads_article(uuid),public.start_threads_article_publish(uuid,uuid,text),
 public.finish_threads_article_publish(uuid,uuid,text,text),public.reconcile_threads_article_publish(uuid,uuid,text,text)
 TO service_role;

-- Migration-first deployment must fail old direct claim/reset before that old
-- application can send a public POST. Only the fixed service RPCs' owner may
-- mutate delivery fields; authenticated article editing permissions stay intact.
CREATE FUNCTION public.guard_threads_delivery_fields() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE rpc_owner name;
BEGIN
 SELECT pg_catalog.pg_get_userbyid(proowner) INTO rpc_owner FROM pg_catalog.pg_proc
 WHERE oid='public.claim_threads_article(uuid)'::regprocedure;
 IF current_user<>rpc_owner AND (NEW.threads_post_id IS DISTINCT FROM OLD.threads_post_id
   OR NEW.threads_posted_at IS DISTINCT FROM OLD.threads_posted_at
   OR NEW.threads_delivery_attempt_id IS DISTINCT FROM OLD.threads_delivery_attempt_id
   OR NEW.threads_delivery_started_at IS DISTINCT FROM OLD.threads_delivery_started_at
   OR NEW.threads_creation_id IS DISTINCT FROM OLD.threads_creation_id
   OR NEW.threads_post_status IS DISTINCT FROM OLD.threads_post_status
   OR NEW.threads_last_error IS DISTINCT FROM OLD.threads_last_error) THEN
  RAISE EXCEPTION 'THREADS_CONSUMER_RELOAD_REQUIRED' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_threads_delivery_fields() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_threads_delivery_fields BEFORE UPDATE ON public.platform_blog_posts
 FOR EACH ROW EXECUTE FUNCTION public.guard_threads_delivery_fields();

-- Storage SDK info has no authoritative owner field. Only this fixed server
-- lookup returns the live actor's object metadata; storage schema stays private.
CREATE FUNCTION public.owned_review_photo_metadata(p_actor_id uuid,p_facility_id uuid,p_object_path text)
RETURNS TABLE(object_id uuid,object_path text,byte_size bigint,mime_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT o.id,o.name,(o.metadata->>'size')::bigint,o.metadata->>'mimetype'
 FROM storage.objects o WHERE o.bucket_id='review-photos' AND o.name=p_object_path AND o.owner_id=p_actor_id::text
 AND o.name ~ ('^reviews/' || p_facility_id::text || '/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$')
 AND EXISTS(SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id=u.id WHERE u.id=p_actor_id)
 AND EXISTS(SELECT 1 FROM public.facility_profiles f WHERE f.id=p_facility_id)
 AND o.metadata->>'size' ~ '^[0-9]{1,10}$';
$$;
REVOKE ALL ON FUNCTION public.owned_review_photo_metadata(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.owned_review_photo_metadata(uuid,uuid,text) TO service_role;

-- Recheck ownership/object/limits in the review INSERT transaction, locking the
-- live account, facility, bucket and objects before any reference commits.
CREATE FUNCTION public.guard_review_photo_references() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE url text; path text; object storage.objects%ROWTYPE; bucket storage.buckets%ROWTYPE; bytes bigint; caller_role text;
BEGIN
 IF coalesce(cardinality(NEW.photo_urls),0)=0 THEN RETURN NEW; END IF;
 -- Auth's ON DELETE SET NULL retains the business review/image references.
 -- It is not a new attachment. A still-live actor cannot use this escape.
 IF TG_OP='UPDATE' AND NEW.user_id IS NULL AND OLD.user_id IS NOT NULL
   AND NEW.photo_urls IS NOT DISTINCT FROM OLD.photo_urls AND NEW.facility_id IS NOT DISTINCT FROM OLD.facility_id
   AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.user_id) THEN RETURN NEW; END IF;
 caller_role:=current_setting('role',true);
 IF caller_role NOT IN ('none','service_role') AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'REVIEW_PHOTO_ACTOR_UNVERIFIED' USING ERRCODE='23514'; END IF;
 IF NEW.user_id IS NULL THEN RAISE EXCEPTION 'REVIEW_PHOTO_ACTOR_UNVERIFIED' USING ERRCODE='23514'; END IF;
 PERFORM public.lock_booking_account(NEW.user_id);
 PERFORM 1 FROM public.facility_profiles WHERE id=NEW.facility_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_PHOTO_FACILITY_UNVERIFIED' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=NEW.user_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_PHOTO_ACTOR_UNVERIFIED' USING ERRCODE='23514'; END IF;
 SELECT * INTO bucket FROM storage.buckets WHERE id='review-photos' FOR SHARE;
 IF NOT FOUND OR bucket.public IS DISTINCT FROM true THEN RAISE EXCEPTION 'REVIEW_PHOTO_BUCKET_UNAVAILABLE' USING ERRCODE='23514'; END IF;
 FOR url IN SELECT unnest(NEW.photo_urls) LOOP
  IF url !~ '^https://[^/]+/storage/v1/object/public/review-photos/reviews/[0-9a-f-]{36}/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$' THEN
   RAISE EXCEPTION 'REVIEW_PHOTO_PATH_UNVERIFIED' USING ERRCODE='23514'; END IF;
  path:=split_part(url,'/storage/v1/object/public/review-photos/',2);
  IF path !~ ('^reviews/' || NEW.facility_id::text || '/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$') THEN
   RAISE EXCEPTION 'REVIEW_PHOTO_FACILITY_UNVERIFIED' USING ERRCODE='23514'; END IF;
  SELECT * INTO object FROM storage.objects WHERE bucket_id='review-photos' AND name=path FOR SHARE;
  IF NOT FOUND OR object.owner_id IS DISTINCT FROM NEW.user_id::text OR object.metadata->>'size' IS NULL OR object.metadata->>'size' !~ '^[0-9]{1,10}$' THEN
   RAISE EXCEPTION 'REVIEW_PHOTO_OBJECT_UNVERIFIED' USING ERRCODE='23514'; END IF;
  bytes:=(object.metadata->>'size')::bigint;
  IF bytes<=0 OR bytes>least(coalesce(bucket.file_size_limit,5242880),5242880)
   OR object.metadata->>'mimetype' IS NULL OR object.metadata->>'mimetype' NOT IN ('image/jpeg','image/png','image/webp')
   OR (bucket.allowed_mime_types IS NOT NULL AND NOT (object.metadata->>'mimetype'=ANY(bucket.allowed_mime_types))) THEN
   RAISE EXCEPTION 'REVIEW_PHOTO_LIMIT_UNVERIFIED' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_review_photo_references() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_review_photo_references BEFORE INSERT OR UPDATE OF photo_urls,user_id,facility_id ON public.facility_reviews
 FOR EACH ROW EXECUTE FUNCTION public.guard_review_photo_references();

-- Check after the object DELETE row lock is taken, using this VOLATILE trigger's
-- fresh read snapshot. A concurrent review INSERT's object SHARE lock otherwise
-- could be followed by a stale-snapshot deletion after the review commits.
CREATE FUNCTION public.guard_referenced_review_object_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.bucket_id='review-photos' AND EXISTS(
   SELECT 1 FROM public.facility_reviews r CROSS JOIN LATERAL unnest(r.photo_urls) u(url)
   WHERE right(split_part(split_part(u.url,'?',1),'#',1),length('/storage/v1/object/public/review-photos/' || OLD.name))
     = '/storage/v1/object/public/review-photos/' || OLD.name
 ) THEN RAISE EXCEPTION 'REVIEW_PHOTO_STILL_REFERENCED' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.guard_referenced_review_object_delete() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_referenced_review_object_delete BEFORE DELETE ON storage.objects
 FOR EACH ROW EXECUTE FUNCTION public.guard_referenced_review_object_delete();

-- An indexed FK enforces reference integrity even if a Storage transaction uses
-- a repeatable snapshot. No physical object or original review is rewritten.
CREATE TABLE public.review_photo_references (
 review_id uuid NOT NULL REFERENCES public.facility_reviews(id) ON DELETE CASCADE,
 object_id uuid NOT NULL REFERENCES storage.objects(id) ON DELETE RESTRICT,
 PRIMARY KEY(review_id,object_id)
);
CREATE INDEX review_photo_references_object ON public.review_photo_references(object_id);
ALTER TABLE public.review_photo_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.review_photo_references FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.review_photo_references TO service_role;
CREATE POLICY review_photo_reference_service ON public.review_photo_references FOR ALL TO service_role USING(true) WITH CHECK(true);
-- Preserve actual existing references without judging the old actor's ownership.
INSERT INTO public.review_photo_references(review_id,object_id)
 SELECT DISTINCT r.id,o.id FROM public.facility_reviews r CROSS JOIN LATERAL unnest(r.photo_urls) u(url)
 JOIN storage.objects o ON o.bucket_id='review-photos'
 AND right(split_part(split_part(u.url,'?',1),'#',1),length('/storage/v1/object/public/review-photos/' || o.name))
   = '/storage/v1/object/public/review-photos/' || o.name;
CREATE FUNCTION public.sync_review_photo_references() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE expected int; actual int;
BEGIN
 IF TG_OP='UPDATE' AND NEW.photo_urls IS NOT DISTINCT FROM OLD.photo_urls AND NEW.facility_id IS NOT DISTINCT FROM OLD.facility_id THEN RETURN NEW; END IF;
 DELETE FROM public.review_photo_references WHERE review_id=NEW.id;
 INSERT INTO public.review_photo_references(review_id,object_id)
 SELECT DISTINCT NEW.id,o.id FROM unnest(NEW.photo_urls) u(url) JOIN storage.objects o ON o.bucket_id='review-photos'
  AND right(u.url,length('/storage/v1/object/public/review-photos/' || o.name))='/storage/v1/object/public/review-photos/' || o.name;
 SELECT count(DISTINCT u.url) INTO expected FROM unnest(NEW.photo_urls) u(url);
 SELECT count(*) INTO actual FROM public.review_photo_references WHERE review_id=NEW.id;
 IF actual<>expected THEN RAISE EXCEPTION 'REVIEW_PHOTO_REFERENCE_UNVERIFIED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_review_photo_references() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sync_review_photo_references AFTER INSERT OR UPDATE OF photo_urls,facility_id ON public.facility_reviews
 FOR EACH ROW EXECUTE FUNCTION public.sync_review_photo_references();
