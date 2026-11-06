-- 「テスト・検証用」と記録した申込を、運営が管理画面から削除できるようにする（2026-11-06 本人決定）。
--
-- 申込の下書き店舗も一緒に消す。店舗を消すと関連する表も連鎖して消え、元に戻せない。
-- そのため、消してよいことを DB の中で確かめる（画面の表示だけに頼らない）。
--   - 運営（本人確認済み）だけが実行できる
--   - 運営が「テスト・検証用」と記録した申込だけ（本物・未確認は消せない）
--   - 画面で見ていた店舗名と今の店舗名が同じこと
--   - 店舗は下書きのときだけ（公開中・停止中は消せない）
--   - 予約・顧客・口コミ・確認書類・掲載枠が 1 件でもある店舗は消せない
--   - 送信待ち・送信中のメールや通知がある申込は消せない
-- 写真のファイルは DB の外にあるので、API が削除後に消す（消す対象をこの関数が返す）。
-- 誰がいつ消したかは audit_logs に残す。
DO $$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL OR to_regclass('public.salon_registration_classifications') IS NULL THEN
    RAISE EXCEPTION 'NOT_CARELINK_DATABASE';
  END IF;
END $$;

CREATE FUNCTION public.delete_test_registration(p_actor uuid, p_salon uuid, p_expected_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.salons%ROWTYPE; f public.facility_profiles%ROWTYPE; has_facility boolean := false; upload_paths text[];
BEGIN
  IF p_actor IS NULL OR p_salon IS NULL OR p_expected_name IS NULL THEN RETURN jsonb_build_object('outcome','invalid'); END IF;
  IF NOT public.registration_verified_account(p_actor) THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;
  PERFORM 1 FROM public.profiles WHERE id=p_actor AND is_platform_admin IS TRUE FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','forbidden'); END IF;

  SELECT * INTO s FROM public.salons WHERE id=p_salon FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_found'); END IF;
  IF s.facility_name IS DISTINCT FROM p_expected_name THEN RETURN jsonb_build_object('outcome','changed'); END IF;
  PERFORM 1 FROM public.salon_registration_classifications WHERE salon_id=p_salon AND classification='test' FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','not_test'); END IF;

  IF s.claimed_facility_id IS NOT NULL THEN
    SELECT * INTO f FROM public.facility_profiles WHERE id=s.claimed_facility_id FOR UPDATE;
    has_facility := FOUND;
  END IF;
  IF has_facility THEN
    IF f.status IS DISTINCT FROM 'draft' THEN RETURN jsonb_build_object('outcome','facility_not_draft'); END IF;
    IF EXISTS (SELECT 1 FROM public.bookings WHERE facility_id=f.id)
      OR EXISTS (SELECT 1 FROM public.booking_create_operations WHERE facility_id=f.id)
      OR EXISTS (SELECT 1 FROM public.customers WHERE facility_id=f.id)
      OR EXISTS (SELECT 1 FROM public.facility_reviews WHERE facility_id=f.id)
      OR EXISTS (SELECT 1 FROM public.featured_slots WHERE facility_id=f.id)
      OR EXISTS (SELECT 1 FROM public.listing_verification_documents WHERE facility_id=f.id)
      OR EXISTS (SELECT 1 FROM public.listing_verification_approvals WHERE facility_id=f.id)
      OR EXISTS (SELECT 1 FROM public.salons o WHERE o.claimed_facility_id=f.id AND o.id<>s.id)
    THEN RETURN jsonb_build_object('outcome','has_activity'); END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.salon_duplicate_links WHERE canonical_receipt_id=s.id OR duplicate_receipt_id=s.id)
  THEN RETURN jsonb_build_object('outcome','has_activity'); END IF;
  IF EXISTS (SELECT 1 FROM public.webhook_retry_queue WHERE registration_id=s.id AND status IN ('pending','processing'))
  THEN RETURN jsonb_build_object('outcome','delivery_in_progress'); END IF;

  -- 他の申込が同じファイルを指しているときは、そのファイルを消さない。
  SELECT coalesce(array_agg(DISTINCT p.path), '{}') INTO upload_paths FROM (
    SELECT ph.object_path AS path FROM public.salon_submission_photos ph
      JOIN public.salon_submission_intents i ON i.id=ph.intent_id WHERE i.salon_id=s.id
    UNION ALL
    SELECT substring(u FROM '/storage/v1/object/public/carelink-uploads/(.+)$')
      FROM unnest(array_append(coalesce(s.photo_urls,'{}'), s.photo_url)) AS u
  ) p WHERE p.path IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.salons o WHERE o.id<>s.id AND (
      o.photo_url LIKE '%/carelink-uploads/'||p.path OR EXISTS (SELECT 1 FROM unnest(o.photo_urls) x WHERE x LIKE '%/carelink-uploads/'||p.path)));

  DELETE FROM public.salon_submission_photos ph USING public.salon_submission_intents i WHERE ph.intent_id=i.id AND i.salon_id=s.id;
  DELETE FROM public.salon_submission_intents WHERE salon_id=s.id;
  DELETE FROM public.salon_recovery_grants WHERE receipt_id=s.id;
  DELETE FROM public.webhook_retry_queue WHERE registration_id=s.id;
  DELETE FROM public.salons WHERE id=s.id;
  IF has_facility THEN DELETE FROM public.facility_profiles WHERE id=f.id; END IF;

  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,old_values)
    VALUES (p_actor,'delete','salons',p_salon::text,jsonb_build_object(
      'facility_name',s.facility_name,'status',s.status,'facility_id',CASE WHEN has_facility THEN f.id END,'classification','test'));
  RETURN jsonb_build_object('outcome','deleted','facility_id',CASE WHEN has_facility THEN f.id END,'upload_paths',to_jsonb(upload_paths));
END $$;
REVOKE ALL ON FUNCTION public.delete_test_registration(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_test_registration(uuid,uuid,text) TO service_role;
NOTIFY pgrst, 'reload schema';
