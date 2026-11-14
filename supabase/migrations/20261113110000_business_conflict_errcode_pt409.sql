-- 点検 A102（2026年11月13日）：業務上の競合に ERRCODE 40001（serialization_failure）を使っていた関数を PT409 に揃える。
--
-- PostgREST は 40001 を「トランザクションの直列化失敗」とみなし、版によっては同じ要求を自動で再試行する。
-- 版の不一致・状態の変化といった【業務上の競合】は再試行しても結果が変わらない（無駄な再実行・監査の重複の原因）。
-- 20261025143701（運営メール）と同じく PT409 に揃える。PostgREST は PT409 を HTTP 409・error.code='PT409' で返す。
--
-- 各関数は「最新定義の全文の写し」を CREATE OR REPLACE し、ERRCODE='40001' → 'PT409' だけを置換した（ほかは 1 文字も変えていない）。
-- 写し元は各関数の直前のコメントに記す。CREATE OR REPLACE は既存の GRANT / REVOKE を保つ。
-- 対象（grep -rn "40001" supabase/migrations で特定・各関数の最後の定義）：
--   manage_platform_editor_atomic / publish_newsletter_send_operation / reorder_admin_menus_atomic /
--   save_admin_facility_integration_atomic / save_admin_menu_atomic / unsubscribe_newsletter_atomic
-- （manage_platform_mail_atomic は既に PT409。40001 はコメント中の言及だけ）
--
-- 🔴 適用順序：【コードの配信の後】に適用する（2 段目）。アプリ側は同日の変更で 40001 と PT409 の両方を 409 として扱う
--    （src/lib/admin-menu-write.ts・platform-editor-write.ts・admin-facility-integration-write.ts・
--     src/app/api/admin/menus/reorder/route.ts・src/app/api/unsubscribe/route.ts・newsletter-send.ts は既存）。
--    旧コードのまま先に適用すると、競合が 409 ではなく 500 として返る。
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;

-- 写し元: 20261022190000_blog_keep_original_published_at.sql（最新定義の全文。ERRCODE 40001 → PT409 だけを置換）
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
  THEN RAISE EXCEPTION 'FEATURE_IMAGE_CHANGED' USING ERRCODE='PT409'; END IF;
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
   IF NOT FOUND THEN RAISE EXCEPTION 'NEWSLETTER_STATE_CHANGED' USING ERRCODE='PT409'; END IF;
   IF n.status<>'scheduled' THEN RAISE EXCEPTION 'NEWSLETTER_STATE_CHANGED' USING ERRCODE='PT409'; END IF;
   UPDATE public.newsletter_campaigns SET status='cancelled',updated_at=clock_timestamp() WHERE id=p_record_id RETURNING to_jsonb(newsletter_campaigns.*) INTO result;
  END IF;
 END IF;
 RETURN result;
END $$;

-- 写し元: 20261009021921_newsletter_admin_delivery_operations.sql（最新定義の全文。ERRCODE 40001 → PT409 だけを置換）
CREATE OR REPLACE FUNCTION public.publish_newsletter_send_operation(p_actor_id uuid,p_campaign_id uuid,p_expected_revision timestamptz,
 p_expected_emails text[],p_unsubscribe_links jsonb,p_from text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.newsletter_campaigns%ROWTYPE; actual text[]; expected text[]; op uuid; recipient uuid; q uuid;
 address text; link text; envelope jsonb; existing jsonb;
BEGIN
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND is_platform_admin FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NEWSLETTER_PLATFORM_ACTOR_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.newsletter_campaigns WHERE id=p_campaign_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NEWSLETTER_CAMPAIGN_NOT_FOUND'; END IF;
 existing:=public.newsletter_operation_receipt(p_campaign_id);
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 -- A pinned new API may run while migrations are only partly applied. Old
 -- workers must already be fenced before any new V2 queue is published.
 IF to_regprocedure('public.webhook_dispatch_v2_version()') IS NULL THEN
  RAISE EXCEPTION 'NEWSLETTER_DISPATCH_UNAVAILABLE'; END IF;
 IF public.webhook_dispatch_v2_version() IS DISTINCT FROM 1 THEN
  RAISE EXCEPTION 'NEWSLETTER_DISPATCH_UNAVAILABLE'; END IF;
 IF c.status NOT IN ('draft','scheduled') THEN RAISE EXCEPTION 'NEWSLETTER_LEGACY_OR_ALREADY_SENT' USING ERRCODE='23514'; END IF;
 IF c.updated_at IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'NEWSLETTER_REVISION_CONFLICT' USING ERRCODE='PT409'; END IF;
 SELECT coalesce(array_agg(email ORDER BY email),'{}') INTO actual FROM public.newsletter_current_recipients(c.campaign_type) email;
 SELECT coalesce(array_agg(email ORDER BY email),'{}') INTO expected FROM unnest(p_expected_emails) email;
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'NEWSLETTER_AUDIENCE_CONFLICT' USING ERRCODE='PT409'; END IF;
 IF cardinality(actual)=0 THEN RAISE EXCEPTION 'NEWSLETTER_NO_RECIPIENTS' USING ERRCODE='23514'; END IF;
 IF p_from IS NULL OR p_from='' OR p_from~E'[\\r\\n\\t]' OR char_length(p_from)>320 OR jsonb_typeof(p_unsubscribe_links)<>'object'
 OR (SELECT count(*) FROM jsonb_object_keys(p_unsubscribe_links))<>cardinality(actual) THEN RAISE EXCEPTION 'NEWSLETTER_ENVELOPE_INVALID' USING ERRCODE='23514'; END IF;
 op:=pg_catalog.gen_random_uuid();
 INSERT INTO public.newsletter_send_operations(operation_id,campaign_id,actor_id,campaign_revision,campaign_snapshot)
 VALUES(op,c.id,p_actor_id,c.updated_at,jsonb_build_object('campaign_type',c.campaign_type,'subject',c.subject,
  'html_content',c.html_content,'text_content',c.text_content,'target_segment',c.target_segment));
 FOREACH address IN ARRAY actual LOOP
  link:=p_unsubscribe_links->>address;
  IF address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR char_length(address)>254
   OR link IS NULL OR char_length(link)>1024 OR link !~ '^https://[^[:space:]"<>]+/unsubscribe\?n=[A-Za-z0-9_-]{20,}$' THEN
    RAISE EXCEPTION 'NEWSLETTER_ENVELOPE_INVALID' USING ERRCODE='23514'; END IF;
  envelope:=jsonb_build_object('from',p_from,'to',address,'subject',left(translate(c.subject,E'\r\n\t','   '),200),
   'html',c.html_content||'<br><br><hr><p style="font-size:11px;color:#999">配信停止は<a href="'||link||'">こちら</a></p>');
  IF c.text_content IS NOT NULL AND c.text_content<>'' THEN
   envelope:=envelope||jsonb_build_object('text',c.text_content||E'\n\n配信停止: '||link);
  END IF;
  IF char_length(envelope->>'html')>100000 OR char_length(envelope->>'subject')=0
   OR (envelope?'text' AND char_length(envelope->>'text')>100000) THEN RAISE EXCEPTION 'NEWSLETTER_ENVELOPE_INVALID' USING ERRCODE='23514'; END IF;
  recipient:=pg_catalog.gen_random_uuid();q:=pg_catalog.gen_random_uuid();
  INSERT INTO public.webhook_retry_queue(id,webhook_type,target_id,payload,email_envelope,status,attempt_count,max_attempts,scheduled_at)
  VALUES(q,'email',address,jsonb_build_object('event_email_version',1,'idempotency_key','carelink-event-email/'||q::text,
   'newsletter_delivery_version',1,'dispatch_version',2,'campaign_id',c.id,'newsletter_operation_id',op,'newsletter_recipient_id',recipient),envelope,'pending',0,3,clock_timestamp());
  INSERT INTO public.newsletter_send_recipients(recipient_id,operation_id,queue_id,email) VALUES(recipient,op,q,address);
 END LOOP;
 UPDATE public.newsletter_campaigns SET status='sending',stats=jsonb_build_object('delivery_mode','newsletter_outbox_v1','operation_id',op,
  'total',cardinality(actual),'queued',cardinality(actual),'accepted',0,'suppressed',0,'failed',0,'unconfirmed',0,'sent',0,'opened',0,'clicked',0,'bounced',0),updated_at=clock_timestamp() WHERE id=c.id;
 RETURN public.newsletter_operation_receipt(c.id);
END $$;

-- 写し元: 20261015133116_menu_delete_and_reorder_atomic.sql（最新定義の全文。ERRCODE 40001 → PT409 だけを置換）
CREATE OR REPLACE FUNCTION public.reorder_admin_menus_atomic(p_actor_id uuid,p_facility_id uuid,p_menu_ids uuid[],p_expected_ids uuid[],p_expected_revision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE f public.facility_profiles%ROWTYPE; category_name text; actual uuid[]; revision timestamptz;
BEGIN
 IF cardinality(p_menu_ids) NOT BETWEEN 2 AND 5000 OR p_menu_ids IS NULL OR p_expected_ids IS NULL
  OR cardinality(p_menu_ids)<>cardinality(p_expected_ids)
  OR EXISTS(SELECT 1 FROM unnest(p_menu_ids) x WHERE x IS NULL)
  OR EXISTS(SELECT 1 FROM unnest(p_expected_ids) x WHERE x IS NULL)
  OR (SELECT count(DISTINCT x) FROM unnest(p_menu_ids) x)<>cardinality(p_menu_ids)
  OR (SELECT array_agg(x ORDER BY x) FROM unnest(p_menu_ids) x) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(p_expected_ids) x)
 THEN RAISE EXCEPTION 'INVALID_MENU_ORDER' USING ERRCODE='22023'; END IF;
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.facility_members m WHERE m.user_id=p_actor_id AND m.facility_id=p_facility_id AND m.role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.facility_profiles p WHERE p.id=p_facility_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_FACILITY_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF f.updated_at IS DISTINCT FROM NULLIF(p_expected_revision,'')::timestamptz THEN RAISE EXCEPTION 'MENU_REVISION_CONFLICT' USING ERRCODE='PT409'; END IF;
 -- Lock IDs in a stable order; inserts/reassignments take the parent FK lock.
 PERFORM m.id FROM public.facility_menus m WHERE m.facility_id=p_facility_id ORDER BY m.id FOR UPDATE;
 SELECT m.category INTO category_name FROM public.facility_menus m WHERE m.id=p_menu_ids[1] AND m.facility_id=p_facility_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 SELECT array_agg(m.id ORDER BY m.sort_order,m.id) INTO actual FROM public.facility_menus m WHERE m.facility_id=p_facility_id AND m.category=category_name;
 IF actual IS DISTINCT FROM p_expected_ids THEN RAISE EXCEPTION 'MENU_ORDER_CONFLICT' USING ERRCODE='PT409'; END IF;
 -- One statement: a trigger/constraint failure restores every position.
 UPDATE public.facility_menus m SET sort_order=(o.position-1)::integer
 FROM unnest(p_menu_ids) WITH ORDINALITY o(menu_id,position) WHERE m.id=o.menu_id AND m.facility_id=p_facility_id;
 UPDATE public.facility_profiles p SET updated_at=greatest(clock_timestamp(),COALESCE(p.updated_at,'-infinity'::timestamptz)+interval '1 microsecond') WHERE p.id=p_facility_id RETURNING p.updated_at INTO revision;
 RETURN jsonb_build_object('outcome','saved','facility_id',p_facility_id,'revision',revision);
END $$;

-- 写し元: 20261023150300_gbp_connect_binds_verified_identity.sql（最新定義の全文。ERRCODE 40001 → PT409 だけを置換）
CREATE OR REPLACE FUNCTION public.save_admin_facility_integration_atomic(p_actor_id uuid,p_facility_id uuid,p_kind text,p_expected jsonb,p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE f public.facility_profiles%ROWTYPE; d public.white_label_domains%ROWTYPE; v public.white_label_domains%ROWTYPE; new_place text;
BEGIN
 IF p_actor_id IS NULL OR p_facility_id IS NULL THEN RAISE EXCEPTION 'INTEGRATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('gbp:connect','gbp:refresh','domain:configure','domain:verify') OR p_values IS NULL OR jsonb_typeof(p_values)<>'object' OR p_expected IS NULL OR jsonb_typeof(p_expected)<>'object'
 THEN RAISE EXCEPTION 'INVALID_INTEGRATION' USING ERRCODE='22023'; END IF;
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.facility_members WHERE user_id=p_actor_id AND facility_id=p_facility_id AND role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INTEGRATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.facility_profiles WHERE id=p_facility_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INTEGRATION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF p_kind='gbp:connect' THEN
  -- 2026-10-23: a connect may carry the facility identity the app verified the place against.
  -- The row is locked above, so a change of name/phone/address after that check is refused
  -- instead of attaching a place that was matched against stale details.
  IF p_expected ? 'identity' AND (p_expected - 'identity')='{}'::jsonb THEN
   IF p_expected->'identity' IS DISTINCT FROM jsonb_build_object('name',f.name,'phone',f.phone,'postal_code',f.postal_code,
     'prefecture',f.prefecture,'city',f.city,'address',f.address)
   THEN RAISE EXCEPTION 'INTEGRATION_CHANGED' USING ERRCODE='PT409'; END IF;
  ELSIF p_expected<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_INTEGRATION' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN ('place_id','cid'))
   OR NOT (p_values ?& ARRAY['place_id','cid'])
   OR (p_values->'place_id'<>'null'::jsonb AND (jsonb_typeof(p_values->'place_id')<>'string' OR (char_length(p_values->>'place_id') NOT BETWEEN 1 AND 300 OR (p_values->>'place_id') !~ '^[A-Za-z0-9_:-]+$')))
   OR (p_values->'cid'<>'null'::jsonb AND (jsonb_typeof(p_values->'cid')<>'string' OR (p_values->>'cid') !~ '^[A-Za-z0-9_:-]{1,64}$'))
  THEN RAISE EXCEPTION 'INVALID_INTEGRATION' USING ERRCODE='22023'; END IF;
  new_place=p_values->>'place_id';
  IF f.gbp_place_id IS DISTINCT FROM new_place THEN
   DELETE FROM public.gbp_audit_cache WHERE facility_id=p_facility_id;
   UPDATE public.facility_profiles SET google_rating=NULL,google_review_count=0 WHERE id=p_facility_id;
  END IF;
  UPDATE public.facility_profiles SET gbp_place_id=new_place,gbp_cid=p_values->>'cid',gbp_connected_at=CASE WHEN new_place IS NULL THEN NULL ELSE now() END WHERE id=p_facility_id;
 ELSIF p_kind='gbp:refresh' THEN
  IF p_expected IS DISTINCT FROM jsonb_build_object('place_id',f.gbp_place_id) OR f.gbp_place_id IS NULL THEN RAISE EXCEPTION 'INTEGRATION_CHANGED' USING ERRCODE='PT409'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN ('rating','review_count','score','details')) OR NOT (p_values ?& ARRAY['rating','review_count','score','details'])
   OR jsonb_typeof(p_values->'details')<>'object'
   OR (p_values->'rating'<>'null'::jsonb AND (jsonb_typeof(p_values->'rating')<>'number' OR (p_values->>'rating')::numeric NOT BETWEEN 0 AND 5))
   OR jsonb_typeof(p_values->'review_count')<>'number' OR (p_values->>'review_count')::numeric NOT BETWEEN 0 AND 2147483647 OR (p_values->>'review_count')::numeric<>trunc((p_values->>'review_count')::numeric)
   OR jsonb_typeof(p_values->'score')<>'number' OR (p_values->>'score')::numeric NOT BETWEEN 0 AND 2147483647 OR (p_values->>'score')::numeric<>trunc((p_values->>'score')::numeric)
  THEN RAISE EXCEPTION 'INVALID_INTEGRATION' USING ERRCODE='22023'; END IF;
  UPDATE public.facility_profiles SET google_rating=(p_values->>'rating')::numeric,google_review_count=(p_values->>'review_count')::integer WHERE id=p_facility_id;
  INSERT INTO public.gbp_audit_cache(facility_id,score,details,fetched_at) VALUES(p_facility_id,(p_values->>'score')::integer,p_values->'details',now()) ON CONFLICT(facility_id) DO UPDATE SET score=EXCLUDED.score,details=EXCLUDED.details,fetched_at=EXCLUDED.fetched_at;
 ELSE
  SELECT * INTO d FROM public.white_label_domains WHERE facility_id=p_facility_id FOR UPDATE;
  IF p_kind='domain:verify' THEN
   IF d.id IS NULL THEN RAISE EXCEPTION 'INTEGRATION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
   IF p_values<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_INTEGRATION' USING ERRCODE='22023'; END IF;
   IF d.txt_record IS NULL OR p_expected IS DISTINCT FROM jsonb_build_object('domain',d.domain,'txt_record',d.txt_record) THEN RAISE EXCEPTION 'INTEGRATION_CHANGED' USING ERRCODE='PT409'; END IF;
   UPDATE public.white_label_domains SET is_verified=true,verified_at=now(),updated_at=now() WHERE id=d.id RETURNING * INTO d;
  ELSE
   IF p_expected<>'{}'::jsonb OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN ('domain','brand_name','primary_color','logo_url','txt_record')) OR NOT (p_values ?& ARRAY['domain','brand_name','primary_color','logo_url','txt_record']) THEN RAISE EXCEPTION 'INVALID_INTEGRATION' USING ERRCODE='22023'; END IF;
   SELECT * INTO v FROM jsonb_populate_record(NULL::public.white_label_domains,p_values);
   IF v.domain IS NULL OR char_length(v.domain)>253 OR v.domain<>lower(v.domain) OR cardinality(string_to_array(v.domain,'.'))<2 OR EXISTS(SELECT 1 FROM unnest(string_to_array(v.domain,'.')) l WHERE char_length(l) NOT BETWEEN 1 AND 63 OR l !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$') OR v.txt_record IS NULL OR v.txt_record !~ '^carelink-verify=[a-f0-9]{32}$' OR char_length(v.brand_name)>100 OR v.primary_color IS NULL OR v.primary_color !~ '^#[0-9a-fA-F]{6}$' OR (v.logo_url IS NOT NULL AND (char_length(v.logo_url) NOT BETWEEN 9 AND 498 OR v.logo_url !~ '^https://[^[:space:]]+$')) THEN RAISE EXCEPTION 'INVALID_INTEGRATION' USING ERRCODE='22023'; END IF;
   INSERT INTO public.white_label_domains(facility_id,domain,brand_name,primary_color,logo_url,txt_record,is_verified,verified_at,updated_at) VALUES(p_facility_id,v.domain,v.brand_name,v.primary_color,v.logo_url,v.txt_record,false,NULL,now()) ON CONFLICT(facility_id) DO UPDATE SET domain=EXCLUDED.domain,brand_name=EXCLUDED.brand_name,primary_color=EXCLUDED.primary_color,logo_url=EXCLUDED.logo_url,txt_record=EXCLUDED.txt_record,is_verified=false,verified_at=NULL,updated_at=EXCLUDED.updated_at RETURNING * INTO d;
  END IF;
  RETURN to_jsonb(d);
 END IF;
 RETURN jsonb_build_object('id',p_facility_id,'facility_id',p_facility_id);
END $$;

-- 写し元: 20261022120000_admin_menu_publish_control.sql（最新定義の全文。ERRCODE 40001 → PT409 だけを置換）
CREATE OR REPLACE FUNCTION public.save_admin_menu_atomic(
 p_actor_id uuid,p_facility_id uuid,p_menu_id uuid,p_values jsonb,
 p_check_photo boolean,p_expected_photo text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE current_menu public.facility_menus%ROWTYPE;
 result_menu public.facility_menus%ROWTYPE; values_menu public.facility_menus%ROWTYPE;
 position integer; facility_status text;
BEGIN
 IF p_actor_id IS NULL OR p_facility_id IS NULL THEN
  RAISE EXCEPTION 'MENU_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF p_values IS NULL OR jsonb_typeof(p_values)<>'object' OR p_values='{}'::jsonb
  OR p_check_photo IS NULL
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN
   ('category','name','description','price','price_note','duration_minutes','photo_url','is_featured','is_published','sort_order'))
  OR (p_values ? 'is_published' AND jsonb_typeof(p_values->'is_published')<>'boolean')
  OR (p_menu_id IS NOT NULL AND p_values ? 'sort_order')
 THEN RAISE EXCEPTION 'INVALID_MENU_MUTATION' USING ERRCODE='22023'; END IF;
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.facility_members m WHERE m.user_id=p_actor_id AND m.facility_id=p_facility_id
  AND m.role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT f.status INTO facility_status FROM public.facility_profiles f WHERE f.id=p_facility_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MENU_FACILITY_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF p_menu_id IS NOT NULL THEN
  SELECT * INTO current_menu FROM public.facility_menus m WHERE m.id=p_menu_id AND m.facility_id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MENU_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  -- A legacy stock-image exemption is valid only for the value observed by
  -- the server guard; a concurrent removal/replacement invalidates it.
  IF p_check_photo AND current_menu.photo_url IS DISTINCT FROM p_expected_photo THEN
   RAISE EXCEPTION 'MENU_PHOTO_CONFLICT' USING ERRCODE='PT409'; END IF;
  SELECT * INTO values_menu FROM jsonb_populate_record(current_menu,p_values);
  -- Same rule as deleting the last menu: a published listing keeps at least
  -- one visible menu. Only a visible -> hidden change is checked, so editing
  -- an already hidden menu (e.g. an HPB draft) is never blocked. Every menu
  -- writer holds the facility row lock taken above, so the count is stable.
  IF facility_status='published' AND COALESCE(current_menu.is_published,true)
   AND values_menu.is_published IS FALSE
   AND NOT EXISTS(SELECT 1 FROM public.facility_menus m WHERE m.facility_id=p_facility_id
    AND m.id<>p_menu_id AND COALESCE(m.is_published,true))
  THEN RAISE EXCEPTION 'MENU_LAST_PUBLISHED' USING ERRCODE='23514'; END IF;
 ELSE
  IF p_check_photo THEN RAISE EXCEPTION 'INVALID_MENU_MUTATION' USING ERRCODE='22023'; END IF;
  SELECT * INTO values_menu FROM jsonb_populate_record(NULL::public.facility_menus,p_values);
 END IF;
 IF values_menu.name IS NULL OR char_length(values_menu.name) NOT BETWEEN 1 AND 100
  OR values_menu.category IS NULL OR char_length(values_menu.category) NOT BETWEEN 1 AND 50
 THEN RAISE EXCEPTION 'INVALID_MENU_MUTATION' USING ERRCODE='22023'; END IF;
 IF p_menu_id IS NULL THEN
  SELECT count(*)::integer INTO position FROM public.facility_menus WHERE facility_id=p_facility_id;
  INSERT INTO public.facility_menus(facility_id,category,name,description,price,price_note,duration_minutes,photo_url,is_featured,is_published,sort_order)
   VALUES(p_facility_id,values_menu.category,values_menu.name,values_menu.description,values_menu.price,values_menu.price_note,
    values_menu.duration_minutes,NULLIF(values_menu.photo_url,''),COALESCE(values_menu.is_featured,false),
    COALESCE(values_menu.is_published,true),COALESCE(values_menu.sort_order,position))
   RETURNING * INTO result_menu;
 ELSE
  UPDATE public.facility_menus m SET category=values_menu.category,name=values_menu.name,description=values_menu.description,
   price=values_menu.price,price_note=values_menu.price_note,duration_minutes=values_menu.duration_minutes,
   photo_url=NULLIF(values_menu.photo_url,''),is_featured=values_menu.is_featured,
   is_published=values_menu.is_published
   WHERE m.id=p_menu_id AND m.facility_id=p_facility_id RETURNING * INTO result_menu;
 END IF;
 UPDATE public.facility_profiles f SET updated_at=greatest(clock_timestamp(),COALESCE(f.updated_at,'-infinity'::timestamptz)+interval '1 microsecond') WHERE f.id=p_facility_id;
 RETURN to_jsonb(result_menu);
END $$;

-- 写し元: 20261023150100_newsletter_confirmed_login_email.sql（最新定義の全文。ERRCODE 40001 → PT409 だけを置換）
CREATE OR REPLACE FUNCTION public.unsubscribe_newsletter_atomic(p_email text,p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE address text; uid uuid; account uuid; token_row public.email_unsubscribe_tokens%ROWTYPE; was_stopped boolean;
BEGIN
 IF (p_email IS NULL)=(p_token IS NULL) THEN RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_INVALID' USING ERRCODE='23514'; END IF;
 IF p_token IS NOT NULL THEN
  IF p_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_INVALID' USING ERRCODE='23514'; END IF;
  SELECT * INTO token_row FROM public.email_unsubscribe_tokens WHERE token=p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',true,'already',true); END IF;
  uid:=token_row.user_id;
  -- 2026-10-23: the token's own account decides the address by its confirmed
  -- login email (where the digest carrying the token was sent), never by the
  -- self-editable profiles.email (which let a token holder stop another address).
  SELECT lower(btrim(u.email)) INTO address FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=uid AND u.email_confirmed_at IS NOT NULL;
  IF address IS NULL OR address='' THEN RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_IDENTITY_UNAVAILABLE'; END IF;
 ELSE address:=lower(btrim(p_email)); END IF;
 IF address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR char_length(address)>254 THEN
  RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_INVALID' USING ERRCODE='23514'; END IF;
 FOR account IN SELECT p.id FROM public.profiles p WHERE lower(btrim(p.email))=address OR p.id=uid
  OR p.id IN (SELECT u.id FROM auth.users u WHERE u.email_confirmed_at IS NOT NULL AND lower(btrim(u.email))=address) ORDER BY p.id LOOP
  PERFORM public.lock_booking_account(account);
 END LOOP;
 PERFORM 1 FROM public.profiles p WHERE lower(btrim(p.email))=address OR p.id=uid
  OR p.id IN (SELECT u.id FROM auth.users u WHERE u.email_confirmed_at IS NOT NULL AND lower(btrim(u.email))=address) ORDER BY p.id FOR UPDATE OF p;
 PERFORM 1 FROM public.newsletter_subscriptions WHERE lower(btrim(email))=address ORDER BY id FOR UPDATE;
 IF p_token IS NOT NULL THEN
  IF address IS DISTINCT FROM (SELECT lower(btrim(u.email)) FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=uid AND u.email_confirmed_at IS NOT NULL) THEN
   RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_IDENTITY_CHANGED' USING ERRCODE='PT409'; END IF;
  SELECT * INTO token_row FROM public.email_unsubscribe_tokens WHERE token=p_token AND user_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_TOKEN_CHANGED' USING ERRCODE='PT409'; END IF;
  IF token_row.used_at IS NOT NULL THEN RETURN jsonb_build_object('success',true,'already',true); END IF;
 END IF;
 was_stopped:=EXISTS(SELECT 1 FROM public.newsletter_subscriptions WHERE lower(btrim(email))=address AND NOT is_active);
 UPDATE public.profiles p SET email_unsubscribed=true WHERE lower(btrim(p.email))=address OR p.id=uid
  OR p.id IN (SELECT u.id FROM auth.users u WHERE u.email_confirmed_at IS NOT NULL AND lower(btrim(u.email))=address);
 UPDATE public.newsletter_subscriptions SET is_active=false,unsubscribed_at=clock_timestamp() WHERE lower(btrim(email))=address;
 -- Guest addresses also acquire a durable all-mail suppression row. Existing
 -- case variants remain inactive; the canonical row handles exact retries.
 INSERT INTO public.newsletter_subscriptions(email,subscription_type,is_active,unsubscribed_at,source)
 VALUES(address,'all',false,clock_timestamp(),'unsubscribe')
 ON CONFLICT(email) DO UPDATE SET is_active=false,unsubscribed_at=excluded.unsubscribed_at;
 IF p_token IS NOT NULL THEN
  UPDATE public.email_unsubscribe_tokens SET used_at=coalesce(used_at,clock_timestamp()) WHERE token=p_token AND user_id=uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'NEWSLETTER_UNSUBSCRIBE_TOKEN_CHANGED' USING ERRCODE='PT409'; END IF;
 END IF;
 RETURN jsonb_build_object('success',true,'already',was_stopped);
END $$;
