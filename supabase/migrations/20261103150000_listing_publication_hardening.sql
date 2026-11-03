-- 掲載の公開まわりの是正（2026-11-03・独立レビューの指摘）。
--   ① 自動公開を DB の中だけで行わない。公開の規則（キャッチコピー・紹介文の禁止表現を含む）は
--      アプリ側（src/lib/facility-publish-gate.ts の listingPublishMissing）が持つため、DB の中で公開すると
--      その検査を通らずに公開されていた。設定保存のトリガ（auto_publish_after_facility_setup）を外し、
--      書類の承認は「公開待ち」の印だけを付ける。公開はアプリが規則を通してから
--      try_auto_publish_verified_facility を呼んで行う（DB は最後の条件と公開ゲートを確かめる）。
--   ② 公開待ちの印は、どの経路で公開されても外す（手動・一括の公開の後に、非公開へ戻した店舗が
--      設定の保存だけで意図せず再公開されないように）。
--   ③ 公開ゲート：却下した申込から作られた店舗は公開しない。「書類は後から」は、書類の確認記録が
--      まだ無い店舗だけに効く（確認した後の店舗名・所在地の変更は、確認し直す）。
--   ④ 却下した申込には「書類は後から」を付けない。付け外しの結果に、店舗が公開中かを返す
--      （外しても公開中の店舗はそのまま公開されるため、画面がそう伝えられるように）。
--   ⑤ 承認を取り消したら、まだ送り始めていない承認メール（cron が取った直後を含む）を止める。もう一度承認したら、止めたメールを送る
--      （送った後・送り始めた後のメールは二度と送らない、は従来どおり）。
--   ⑥ ログイン後に申込の続きへ自動で送るのは、運営が承認し、まだ誰も店舗を作っていない申込があるときだけ
--      （公開フォームから他人のメールアドレスで申し込まれても、その人の着地点を変えられないように）。
-- 既存の確認記録・公開中の店舗・提出済みの書類・送信済みのメールには触れない（下書き以外の店舗に残った公開待ちの印だけを外す）。
BEGIN;
DO $guard$ BEGIN
  IF to_regclass('public.salons') IS NULL OR to_regclass('public.facility_profiles') IS NULL
    OR to_regclass('public.listing_verification_approvals') IS NULL
    OR to_regclass('public.listing_verification_deferrals') IS NULL
    OR to_regclass('public.webhook_retry_queue') IS NULL THEN
    RAISE EXCEPTION 'CareLink のデータベースではありません';
  END IF;
END $guard$;

-- ① 設定保存のトリガによる自動公開をやめる。
DROP TRIGGER auto_publish_after_facility_setup ON public.facility_profiles;
DROP FUNCTION public.auto_publish_after_facility_setup();

-- ③ 公開ゲート（20261103120000 の判定に、却下と「書類は後から」の条件を足す）。
CREATE OR REPLACE FUNCTION public.guard_listing_publication_verification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE identity jsonb; checked boolean; approval_recorded boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM 'published' THEN RETURN NEW; END IF;
  identity := jsonb_build_object('name',NEW.name,'prefecture',NEW.prefecture,'city',NEW.city,'address',NEW.address);
  approval_recorded := EXISTS (SELECT 1 FROM public.listing_verification_approvals WHERE facility_id=NEW.id);
  IF TG_OP='INSERT' THEN checked := true;
  ELSE
    checked := OLD.status IS DISTINCT FROM 'published'
      OR (approval_recorded
        AND identity IS DISTINCT FROM jsonb_build_object('name',OLD.name,'prefecture',OLD.prefecture,'city',OLD.city,'address',OLD.address));
  END IF;
  IF NOT checked THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.salons s WHERE s.claimed_facility_id=NEW.id AND s.status='rejected') THEN
    RAISE check_violation USING MESSAGE='"published_listing_registration_rejected"';
  END IF;
  IF NOT approval_recorded AND EXISTS (SELECT 1 FROM public.salons s
      JOIN public.listing_verification_deferrals d ON d.salon_id=s.id AND d.deferred
      WHERE s.claimed_facility_id=NEW.id) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.listing_verification_approvals a
      WHERE a.facility_id=NEW.id AND a.facility_identity=identity
      AND NOT EXISTS (SELECT 1 FROM unnest(a.document_ids) d(id)
        LEFT JOIN public.listing_verification_documents doc ON doc.id=d.id AND doc.facility_id=NEW.id
        LEFT JOIN public.facility_members m ON m.facility_id=NEW.id AND m.user_id=doc.submitted_by AND m.role IN ('owner','admin')
        WHERE doc.id IS NULL OR m.user_id IS NULL OR NOT EXISTS
          (SELECT 1 FROM storage.objects o WHERE o.bucket_id='listing-verification' AND o.name=doc.object_path))) THEN
    RAISE check_violation USING MESSAGE='"published_listing_verification_required"';
  END IF;
  RETURN NEW;
END;
$$;

-- ④ 「書類は後から」の付け外し。却下した申込には付けない。結果に店舗が公開中かを返す。
CREATE OR REPLACE FUNCTION public.set_listing_verification_deferral(p_actor uuid, p_salon uuid, p_deferred boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old_row public.listing_verification_deferrals%ROWTYPE; new_revision integer; salon public.salons%ROWTYPE;
  facility_published boolean;
BEGIN
 IF p_actor IS NULL OR p_salon IS NULL OR p_deferred IS NULL THEN RETURN jsonb_build_object('outcome','invalid'); END IF;
 IF NOT public.registration_verified_account(p_actor) THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor AND is_platform_admin IS TRUE FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
 SELECT * INTO salon FROM public.salons WHERE id=p_salon FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
 IF p_deferred AND salon.status='rejected' THEN RETURN jsonb_build_object('outcome','rejected'); END IF;
 facility_published := EXISTS (SELECT 1 FROM public.facility_profiles f WHERE f.id=salon.claimed_facility_id AND f.status='published');
 SELECT * INTO old_row FROM public.listing_verification_deferrals WHERE salon_id=p_salon FOR UPDATE;
 IF NOT FOUND THEN
   IF NOT p_deferred THEN RETURN jsonb_build_object('outcome','unchanged','deferred',false); END IF;
   INSERT INTO public.listing_verification_deferrals(salon_id,deferred,updated_by) VALUES (p_salon,true,p_actor);
   new_revision := 1;
 ELSE
   IF old_row.deferred = p_deferred THEN RETURN jsonb_build_object('outcome','unchanged','deferred',p_deferred); END IF;
   UPDATE public.listing_verification_deferrals SET deferred=p_deferred, revision=revision+1, updated_by=p_actor, updated_at=now()
     WHERE salon_id=p_salon RETURNING revision INTO new_revision;
 END IF;
 INSERT INTO public.audit_logs(user_id,action,table_name,record_id,new_values)
   VALUES(p_actor,'update','listing_verification_deferrals',p_salon::text,jsonb_build_object('deferred',p_deferred,'revision',new_revision));
 RETURN jsonb_build_object('outcome','updated','deferred',p_deferred,'revision',new_revision,'facility_published',facility_published);
END $$;

-- ① 書類の承認は、下書きの店舗に公開待ちの印を付けるだけ（元の判定はそのまま）。公開はアプリが行う。
CREATE OR REPLACE FUNCTION public.approve_listing_verification(
  p_actor_id uuid, p_facility_id uuid, p_document_ids uuid[], p_expected_identity jsonb,
  p_document_verified boolean, p_authority_verified boolean
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.facility_profiles%ROWTYPE; d public.listing_verification_documents%ROWTYPE; document_id uuid;
BEGIN
  IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_document_ids IS NULL OR p_expected_identity IS NULL
    OR cardinality(p_document_ids) NOT BETWEEN 1 AND 5
    OR array_position(p_document_ids,NULL) IS NOT NULL
    OR (SELECT count(DISTINCT x) FROM unnest(p_document_ids) x) <> cardinality(p_document_ids)
    OR p_document_verified IS DISTINCT FROM true OR p_authority_verified IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'LISTING_VERIFICATION_CONFIRMATION_REQUIRED'; END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND is_platform_admin IS TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LISTING_VERIFICATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
  FOR document_id IN SELECT x FROM unnest(p_document_ids) x ORDER BY x LOOP
    SELECT * INTO d FROM public.listing_verification_documents
      WHERE id=document_id AND facility_id=p_facility_id FOR SHARE;
    IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM storage.objects
        WHERE bucket_id='listing-verification' AND name=d.object_path) THEN
      RAISE EXCEPTION 'LISTING_VERIFICATION_DOCUMENT_NOT_FOUND';
    END IF;
    PERFORM 1 FROM public.facility_members WHERE facility_id=p_facility_id AND user_id=d.submitted_by
      AND role IN ('owner','admin') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'LISTING_VERIFICATION_APPLICANT_CHANGED'; END IF;
  END LOOP;
  SELECT * INTO f FROM public.facility_profiles WHERE id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LISTING_VERIFICATION_FACILITY_NOT_FOUND'; END IF;
  IF p_expected_identity IS DISTINCT FROM jsonb_build_object('name',f.name,'prefecture',f.prefecture,'city',f.city,'address',f.address)
  THEN RAISE EXCEPTION 'LISTING_VERIFICATION_IDENTITY_CHANGED'; END IF;
  INSERT INTO public.listing_verification_approvals (facility_id,document_ids,reviewed_by,facility_identity,auto_publish_pending)
    VALUES (f.id,p_document_ids,p_actor_id,jsonb_build_object('name',f.name,'prefecture',f.prefecture,'city',f.city,'address',f.address),
      f.status = 'draft')
  ON CONFLICT (facility_id) DO UPDATE SET
    document_ids=EXCLUDED.document_ids, reviewed_by=EXCLUDED.reviewed_by, reviewed_at=clock_timestamp(),
    facility_identity=EXCLUDED.facility_identity, auto_publish_pending=EXCLUDED.auto_publish_pending;
  INSERT INTO public.listing_verification_approval_documents(facility_id,document_id)
    SELECT f.id, x FROM unnest(p_document_ids) x ON CONFLICT DO NOTHING;
  INSERT INTO public.audit_logs(user_id,facility_id,action,table_name,record_id,new_values)
    VALUES(p_actor_id,f.id,'verify','listing_verification_approvals',f.id::text,
      jsonb_build_object('document_ids',p_document_ids,'document_verified',true,'authority_verified',true));
  RETURN true;
END;
$$;

-- ① アプリが公開の規則を通した後に呼ぶ。公開待ちの下書きの店舗だけを、行をロックしてから公開する。
-- 結果：published（公開した）／not_pending（公開待ちの印が無い）／not_draft（下書きではない）／
--       not_ready（店舗名・所在地・営業時間・オーナーが揃っていない）／blocked（公開ゲートが止めた）。
DROP FUNCTION public.try_auto_publish_verified_facility(uuid, uuid);
CREATE FUNCTION public.try_auto_publish_verified_facility(p_facility_id uuid, p_actor uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_status text;
BEGIN
  IF p_facility_id IS NULL OR p_actor IS NULL THEN RAISE EXCEPTION 'LISTING_AUTO_PUBLISH_INVALID'; END IF;
  SELECT status INTO current_status FROM public.facility_profiles WHERE id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_draft'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.listing_verification_approvals
      WHERE facility_id=p_facility_id AND auto_publish_pending) THEN RETURN 'not_pending'; END IF;
  IF current_status IS DISTINCT FROM 'draft' THEN RETURN 'not_draft'; END IF;
  IF NOT public.facility_ready_for_auto_publication(p_facility_id) THEN RETURN 'not_ready'; END IF;
  BEGIN
    UPDATE public.facility_profiles SET status='published', updated_at=clock_timestamp() WHERE id=p_facility_id;
  EXCEPTION WHEN check_violation THEN
    RETURN 'blocked';
  END;
  INSERT INTO public.audit_logs(user_id,facility_id,action,table_name,record_id,new_values)
    VALUES(p_actor,p_facility_id,'publish','facility_profiles',p_facility_id::text,
      jsonb_build_object('status','published','reason','listing_verification_approved'));
  RETURN 'published';
END $$;
REVOKE ALL ON FUNCTION public.try_auto_publish_verified_facility(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_auto_publish_verified_facility(uuid,uuid) TO service_role;

-- ② どの経路で公開されても、公開待ちの印を外す。
CREATE FUNCTION public.clear_listing_auto_publish_pending() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.listing_verification_approvals SET auto_publish_pending=false
    WHERE facility_id=NEW.id AND auto_publish_pending;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.clear_listing_auto_publish_pending() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER clear_listing_auto_publish_pending
  AFTER UPDATE OF status ON public.facility_profiles
  FOR EACH ROW WHEN (NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published')
  EXECUTE FUNCTION public.clear_listing_auto_publish_pending();
-- 20261103120000 の頃に手動・一括の公開で印が残った店舗（下書き以外なのに公開待ち）を片付ける。
-- 残すと、その店舗が後で非公開に戻して設定を保存しただけで、意図せず再公開される。
UPDATE public.listing_verification_approvals a SET auto_publish_pending=false
  FROM public.facility_profiles f
  WHERE f.id=a.facility_id AND a.auto_publish_pending AND f.status IS DISTINCT FROM 'draft';

-- ⑤ 承認メール：もう一度承認されたら、承認の取り消しで止めたメール（送り始めていないもの）だけを送り直す。
CREATE OR REPLACE FUNCTION public.enqueue_salon_approval_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.webhook_retry_queue
    (webhook_type, target_id, payload, registration_id, notification_kind, template_version)
  VALUES ('salon_registration_email', NEW.id::text, '{}'::jsonb, NEW.id, 'approval', 1)
  ON CONFLICT (registration_id, notification_kind, template_version) WHERE registration_id IS NOT NULL
  DO UPDATE SET status='pending', attempt_count=0, scheduled_at=clock_timestamp(), last_error=NULL,
    claimed_at=NULL, processed_at=NULL
  WHERE public.webhook_retry_queue.status='cancelled' AND public.webhook_retry_queue.delivery_started_at IS NULL;
  RETURN NULL;
END $$;

-- ⑤ 承認を取り消したら、まだ送り始めていない承認メールを止める。
CREATE FUNCTION public.cancel_salon_approval_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- cron が取った直後（processing）でも、送信を始める前なら止める。cron は送信開始を記録するときに
  -- 「processing・自分の claim・未開始」を条件にするので、止めた行には送信を始めない。
  UPDATE public.webhook_retry_queue SET status='cancelled', last_error='registration_approval_revoked'
    WHERE registration_id=NEW.id AND notification_kind='approval' AND template_version=1
      AND status IN ('pending','processing') AND delivery_started_at IS NULL;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.cancel_salon_approval_notice() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER salons_cancel_approval_notice
  AFTER UPDATE OF status ON public.salons
  FOR EACH ROW
  WHEN (OLD.status = 'approved' AND NEW.status IS DISTINCT FROM 'approved')
  EXECUTE FUNCTION public.cancel_salon_approval_notice();

-- ⑥ 確認済みのメールアドレスに、運営が承認し、まだ誰も店舗を作っていない申込があるか。
CREATE FUNCTION public.has_claimable_approved_salon_receipt(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users u
    JOIN public.salons s ON lower(btrim(s.email))=lower(btrim(u.email))
    WHERE u.id=p_user_id AND u.email_confirmed_at IS NOT NULL AND btrim(coalesce(u.email,''))<>''
      AND s.source='register' AND s.status='approved'
      AND s.claimed_by_user_id IS NULL AND s.claimed_at IS NULL AND s.claimed_facility_id IS NULL);
$$;
REVOKE ALL ON FUNCTION public.has_claimable_approved_salon_receipt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_claimable_approved_salon_receipt(uuid) TO service_role;
COMMIT;
