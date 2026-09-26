'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm, useWatch, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import { salonStep1Schema, salonStep2Schema, salonStep3Schema, salonFullSchema, type SalonFormValues, formatPhone, businessTypes } from '@/lib/validations';
import { facilityFeatures, DESIRED_START_DATES, desiredStartDateLabels } from '@/lib/constants';
import StepIndicator from '@/components/StepIndicator';
import MultiPhotoUpload, { type PhotoSlot } from '@/components/MultiPhotoUpload';
import Spinner from '@/components/Spinner';
import { compressImage } from '@/lib/image-compress';
import { rollbackUploadedSalonPhotos } from '@/lib/salon-photo-rollback';
import { settleSalonUploads, readSalonRegistrationResult, SALON_SUBMISSION_UNKNOWN } from '@/lib/salon-registration-delivery';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { getRecaptchaToken } from '@/lib/recaptcha-client';
import { extractPrefecture, extractCity } from '@/lib/japan-address';
import { SALON_FIELD_MESSAGES, type SalonFieldErrors } from '@/lib/salon-field-errors';
import { normalizePhone } from '@/lib/phone';
import { SalonRegistrationBrowser } from '@/lib/salon-registration-browser';
import { SALON_COMPLETE_PATH } from '@/lib/salon-browser-context';

const stepSchemas = [salonStep1Schema, salonStep2Schema, salonStep3Schema];
const stepLabels = ['基本情報', '詳細情報', 'PR情報'];

const photoSlots: PhotoSlot[] = [
  { label: '外観' },
  { label: '内観 1' },
  { label: '内観 2' },
  { label: '内観 3' },
  { label: 'メニュー 1' },
  { label: 'メニュー 2' },
  { label: 'メニュー 3' },
];

// 【2026年8月20日 恒久根治】値を直書きせず単一ソース（src/lib/constants.ts）から組み立てる。
// フォーム側にだけ値を書ける状態を無くし、サーバー（api/salons/route.ts の zod）とズレる
// 経路自体を断つ（片方に選択肢を足しても他方が知らない、という事故を構造的に防ぐ）。
const startDateOptions = [
  { value: '', label: '選択してください' },
  ...DESIRED_START_DATES.map((value) => ({ value, label: desiredStartDateLabels[value] })),
];

export default function RegisterForm({ v2Enabled = false }: { v2Enabled?: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [pendingFocus, setPendingFocus] = useState<{ field: keyof SalonFormValues } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submissionUnknown, setSubmissionUnknown] = useState(false);
  const submissionUnknownRef = useRef(false);
  const v2 = useRef<SalonRegistrationBrowser | null>(null);
  const [v2Ready, setV2Ready] = useState(!v2Enabled);
  const [v2Message, setV2Message] = useState('');
  const addressLookupGeneration = useRef(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [photoFiles, setPhotoFiles] = useState<(File | null)[]>(photoSlots.map(() => null));
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [agreed, setAgreed] = useState(false);
  // 【2026年7月29日】許認可・届出の表明保証（利用規約 第12条）。規約への一括同意とは別建てにする。
  // 一括同意に埋めると「読んでいない・気づいていない」の余地が残り、責任分界の証跡として弱い。
  // 独立したチェックにすることで、掲載者が届出義務を認識した上で登録した事実を明確に残す。
  const [licenseWarranted, setLicenseWarranted] = useState(false);

  const { register, handleSubmit, trigger, setValue, setError, getFieldState, getValues, control, formState: { errors, isReady } } = useForm<SalonFormValues>({
    resolver: zodResolver(salonFullSchema),
    mode: 'onTouched',
    defaultValues: {
      facility_name: '', business_type: '', representative_name: '', contact_name: '',
      email: '', phone: '', contact_phone: '', website: '',
      postal_code: '', address: '', prefecture: null, city: null, building_name: '', nearest_station: '',
      business_hours: '', regular_holiday: '', seat_count: null, staff_count: null,
      has_parking: false, features: [],
      pr_text: '', desired_start_date: '',
    },
  });

  const prText = useWatch({ control, name: 'pr_text' }) || '';
  const postalCode = useWatch({ control, name: 'postal_code' }) || '';
  const selectedFeatures = useWatch({ control, name: 'features' }) || [];
  const addressRegistration = register('address');

  useEffect(() => {
    if (!v2Enabled) return;
    let cancelled = false;
    const initialize = async () => {
      if (!v2.current) v2.current = new SalonRegistrationBrowser({
        store: window.sessionStorage, request: fetch, uuid: () => crypto.randomUUID(),
        captcha: () => getRecaptchaToken('salons'), compress: compressImage,
        upload: async (bucket, path, token, file) => supabase.storage.from(bucket)
          .uploadToSignedUrl(path, token, file, { contentType: file.type }),
      });
      const result = await v2.current.reconcile();
      if (cancelled) return;
      if (result.state === 'confirmed') router.push(SALON_COMPLETE_PATH);
      else if (result.state === 'ready') setV2Ready(true);
      else {
        submissionUnknownRef.current = true; setSubmissionUnknown(true);
        setV2Message(result.message);
      }
    };
    void initialize().catch(() => {
      if (cancelled) return;
      submissionUnknownRef.current = true; setSubmissionUnknown(true);
      setV2Message('申込の確認情報を保存できません。ブラウザーの設定をご確認ください。新たに送信せず、お問い合わせください。');
    });
    return () => { cancelled = true; };
  }, [v2Enabled, router]);

  const acceptV2Result = (result: Awaited<ReturnType<SalonRegistrationBrowser['submit']>>) => {
    if (result.state === 'confirmed') { setIsDirty(false); router.push(SALON_COMPLETE_PATH); }
    else if (result.state === 'ready' || result.state === 'retryable') {
      submissionUnknownRef.current = false; setSubmissionUnknown(false); setV2Ready(true);
      if (result.state === 'retryable') {
        if (result.fieldErrors) showServerErrors(result.fieldErrors);
        setToast({ message: result.message, type: 'error' });
      }
    } else {
      submissionUnknownRef.current = true; setSubmissionUnknown(true); setV2Message(result.message);
    }
  };

  const reconcileV2 = async () => {
    if (submitLockRef.current || !v2.current) return;
    submitLockRef.current = true; setSubmitting(true);
    try { acceptV2Result(await v2.current.retryUnknown()); }
    catch {
      submissionUnknownRef.current = true; setSubmissionUnknown(true);
      setV2Message(SALON_SUBMISSION_UNKNOWN);
    }
    finally { submitLockRef.current = false; setSubmitting(false); }
  };

  // Wait until the target step is mounted before expanding optional fields and
  // focusing. RHF cannot focus an unmounted or collapsed field on its own.
  useEffect(() => {
    if (!pendingFocus) return;
    const element = document.querySelector<HTMLElement>(`[name="${pendingFocus.field}"], [data-field="${pendingFocus.field}"]`);
    if (element) {
      const details = element.closest('details');
      if (details) details.open = true;
      element.focus();
    }
  }, [pendingFocus]);

  const revealErrors = (fieldErrors: FieldErrors<SalonFormValues>) => {
    for (const [index, schema] of stepSchemas.entries()) {
      const field = (Object.keys(schema.shape) as (keyof SalonFormValues)[]).find(key => fieldErrors[key]);
      if (field) {
        setStep(index + 1);
        setPendingFocus({ field: field === 'prefecture' || field === 'city' ? 'address' : field });
        return;
      }
    }
  };

  const showServerErrors = (fieldErrors: SalonFieldErrors) => {
    const visibleErrors: FieldErrors<SalonFormValues> = {};
    for (const key of Object.keys(salonFullSchema.shape) as (keyof SalonFormValues)[]) {
      if (!fieldErrors[key]) continue;
      const field = key === 'prefecture' || key === 'city' ? 'address' : key;
      const error = { type: 'server', message: fieldErrors[key] };
      setError(field, error);
      visibleErrors[field] = error;
    }
    if (fieldErrors.photo_url || fieldErrors.photo_urls) {
      setPhotoError(SALON_FIELD_MESSAGES.photo_urls);
    }
    revealErrors(visibleErrors);
  };

  // Phone auto-hyphen
  const handlePhoneChange = (field: 'phone' | 'contact_phone') => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(field, formatPhone(normalizePhone(e.target.value)), { shouldValidate: true });
  };

  // Postal responses are suggestions tied to the input generation, never an
  // authority to overwrite a newer postcode or a manually corrected address.
  useEffect(() => {
    const generation = ++addressLookupGeneration.current;
    const digits = postalCode.replace(/\D/g, '');
    if (digits.length !== 7) return;
    let cancelled = false;
    const previousAddress = getValues('address');
    void (async () => {
      try {
        const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${digits}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || generation !== addressLookupGeneration.current
          || (getValues('postal_code') || '').replace(/\D/g, '') !== digits
          || getValues('address') !== previousAddress) return;
        const r = Array.isArray(data?.results) ? data.results[0] : null;
        if (!r || typeof r.address1 !== 'string' || !r.address1
          || typeof r.address2 !== 'string' || !r.address2
          || typeof r.address3 !== 'string') return;
        setValue('address', `${r.address1}${r.address2}${r.address3}`);
        setValue('prefecture', r.address1);
        setValue('city', r.address2);
      } catch { /* Optional lookup failure leaves manual input intact. */ }
    })();
    return () => { cancelled = true; };
  }, [postalCode, getValues, setValue]);

  const handleAddressChange = () => {
    addressLookupGeneration.current++;
    setValue('prefecture', null);
    setValue('city', null);
  };

  // Page leave warning
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const handleFieldChange = () => { if (!isDirty) setIsDirty(true); };

  // Feature toggle
  const toggleFeature = (feature: string) => {
    const current = selectedFeatures;
    const updated = current.includes(feature)
      ? current.filter(f => f !== feature)
      : [...current, feature];
    setValue('features', updated);
  };

  const nextStep = async () => {
    const schema = stepSchemas[step - 1];
    const fields = Object.keys(schema.shape) as (keyof SalonFormValues)[];
    if (await trigger(fields)) setStep(step + 1);
    else {
      const invalid: FieldErrors<SalonFormValues> = {};
      for (const field of fields) {
        const error = getFieldState(field).error;
        if (error) invalid[field] = { type: 'validation', message: error.message };
      }
      revealErrors(invalid);
    }
  };

  const onSubmit = async (data: SalonFormValues) => {
    if (submissionUnknownRef.current) return;
    setSubmitting(true);
    setPhotoError(null);
    if (v2Enabled) {
      try {
        if (!v2.current) throw new Error('Registration context unavailable');
        acceptV2Result(await v2.current.submit(data, photoFiles));
      } catch {
        submissionUnknownRef.current = true; setSubmissionUnknown(true);
        setV2Message(SALON_SUBMISSION_UNKNOWN);
      } finally { setSubmitting(false); }
      return;
    }
    // 【2026年7月8日 恒久根治】写真アップロード成功後に /api/salons が失敗（バリデーション/
    // レート制限/ネットワーク断等）すると、アップロード済みファイルがストレージに孤児として
    // 残り続けていた。再送信時は毎回新しい crypto.randomUUID() で再アップロードするため、
    // 失敗を繰り返すほど孤児が積み上がる。成功パスは全upload確定後に回収する。
    // POST後に結果不明となった写真は、保存済み行から参照される可能性があるため保全する。
    const uploadedPaths: string[] = [];
    let requestStarted = false;
    let confirmedRejection = false;
    try {
      // Upload photos
      const uuid = crypto.randomUUID();
      const categories = ['exterior', 'interior_1', 'interior_2', 'interior_3', 'menu_1', 'menu_2', 'menu_3'];
      const mimeToExt: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

      // 監査P6: 従来は生ファイルを無圧縮・直列アップロードしていた（最大7枚×10MB）。
      // 各ファイルを圧縮して並列uploadし、失敗があっても全件の確定を待つ。
      // map はインデックス順を保持し、filter で order を保ったまま null（未選択枠）を除く。
      const uploadResults = await settleSalonUploads(
        photoFiles.map(async (file, i) => {
          if (!file) return null;
          const compressed = await compressImage(file).catch(() => file); // 圧縮失敗時は元ファイル
          const ext = mimeToExt[compressed.type] || 'jpg';
          const path = `salons/${uuid}/${categories[i]}.${ext}`;
          const { error: uploadError } = await supabase.storage.from('carelink-uploads').upload(path, compressed);
          if (uploadError) throw uploadError;
          uploadedPaths.push(path);
          return supabase.storage.from('carelink-uploads').getPublicUrl(path).data.publicUrl;
        })
      );
      const photoUrls = uploadResults.filter((u): u is string => !!u);
      const recaptchaToken = await getRecaptchaToken('salons');

      // 【2026年8月20日 恒久根治】zipcloud 由来（data.prefecture/data.city）を優先し、
      // 郵便番号を使わず住所を直接書いた人・zipcloud が落ちていたときは自由文の address から
      // 復元する（japan-address.ts）。どちらも取れなければ null のまま送る（推測で埋めない）。
      const prefecture = data.prefecture || extractPrefecture(data.address) || null;
      const city = data.city || extractCity(data.address) || null;

      requestStarted = true;
      const res = await fetch('/api/salons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facility_name: data.facility_name,
          business_type: data.business_type,
          representative_name: data.representative_name,
          contact_name: data.contact_name,
          email: data.email,
          phone: data.phone,
          contact_phone: data.contact_phone || null,
          website: data.website || null,
          postal_code: data.postal_code || null,
          address: data.address || null,
          prefecture,
          city,
          building_name: data.building_name || null,
          nearest_station: data.nearest_station || null,
          business_hours: data.business_hours || null,
          regular_holiday: data.regular_holiday || null,
          // 0 は有効値（席数/スタッフ数 0）。`data.seat_count &&` は 0 を falsy 扱いして
          // null 化してしまうため、typeof number 判定にする（空欄は valueAsNumber で NaN → null）。
          seat_count: typeof data.seat_count === 'number' && !isNaN(data.seat_count) ? data.seat_count : null,
          staff_count: typeof data.staff_count === 'number' && !isNaN(data.staff_count) ? data.staff_count : null,
          has_parking: data.has_parking || false,
          features: data.features || [],
          pr_text: data.pr_text || null,
          photo_url: photoUrls[0] || null,
          photo_urls: photoUrls,
          desired_start_date: data.desired_start_date || null,
          // 【2026年7月16日 恒久根治・/api/notify 廃止対応】従来はここで送信成功後に
          // 認証なしの公開POST /api/notify を別途叩いて Slack 通知していたが、外部から
          // 偽アラートを送れる構造的脆弱性だったため廃止。/api/salons が保存成功後に
          // サーバー側から直接 Slack 通知を送るため、どちらのテンプレートを使うかを
          // このフィールドで伝える（DBには保存されない）。
          source: 'register',
          ...(recaptchaToken ? { recaptcha_token: recaptchaToken } : {}),
        }),
      });
      const result = await readSalonRegistrationResult(res);
      if (result.kind === 'rejected') {
        confirmedRejection = true;
        if (result.fieldErrors) showServerErrors(result.fieldErrors);
        throw new Error(result.message);
      }
      if (result.kind === 'unknown') throw new Error(SALON_SUBMISSION_UNKNOWN);

      setIsDirty(false);
      // 【2026年7月8日 恒久根治】/register/complete はクライアント供給の name/type/area だけを表示
      // しており、サーバー確認なしで誰でも任意の値を使って「登録完了しました」画面を直接開けた
      // （実登録なしでの偽装表示・分析上のコンバージョン計測歪みの懸念）。/api/salons が返す
      // salon id を渡し、complete ページ側でその id が実在する登録データか検証してから
      // サーバー側の実データを表示する方式に変更する。
      const params = new URLSearchParams();
      params.set('id', result.id);
      router.push(`/register/complete?${params.toString()}`);
    } catch (e) {
      if (!requestStarted || confirmedRejection) {
        await rollbackUploadedSalonPhotos(uploadedPaths);
        const message = e instanceof Error ? e.message : '送信に失敗しました。時間をおいて再度お試しください。';
        setToast({ message, type: 'error' });
      } else {
        submissionUnknownRef.current = true;
        setSubmissionUnknown(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // submitting(state)だけを見ると、zodResolver の非同期検証が終わり setSubmitting(true)が
  // 反映されるまでの間（Reactの再レンダーを跨ぐ猶予）に連打されると両方とも通ってしまう
  // （state 更新は非同期・バッチされるため）。ref は同期的に読み書きできるため、
  // 同一tick内の連打も含めて確実にブロックできる（写真の二重アップロード・施設の二重登録を防止）。
  const submitLockRef = useRef(false);

  const handleConfirmSubmit = () => {
    if (submitLockRef.current || submissionUnknownRef.current) return;
    submitLockRef.current = true;
    setShowConfirm(false);
    handleSubmit(onSubmit, revealErrors)().finally(() => {
      submitLockRef.current = false;
    });
  };

  return (
    <div className="mx-auto max-w-[640px] sm:px-12">
      <div>
        <StepIndicator currentStep={step} totalSteps={3} labels={stepLabels} />
        {submissionUnknown && (
          <div role="alert" className="mb-4 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p>{v2Enabled ? v2Message : SALON_SUBMISSION_UNKNOWN}</p>
            {v2Enabled && <button type="button" onClick={() => void reconcileV2()} disabled={submitting}
              className="block mt-3 underline">同じ申込の受付状況を確認</button>}
            <Link href="/contact" className="mt-2 inline-block underline">受付状況を問い合わせる</Link>
          </div>
        )}
        {(!isReady || (!v2Ready && !submissionUnknown)) && (
          <div role="status" className="mb-3 text-sm text-gray-600">
            <p>入力フォームを準備しています。表示が変わらない場合はJavaScriptの設定と通信状況を確認してください。</p>
            <form action="/register" method="get">
              <button type="submit" className="underline">ページを再読み込み</button>
            </form>
          </div>
        )}
        <form onSubmit={handleSubmit(() => setShowConfirm(true), revealErrors)} onChange={handleFieldChange} noValidate className="border-y border-[var(--ecru-line)] bg-[var(--ecru-surface)] px-5 py-7 sm:border sm:px-10 sm:py-10">
          {/* SSR中の入力をRHFの初期化が消さないよう、購読・refの準備完了まで操作を止める。 */}
          <fieldset disabled={!isReady || !v2Ready || submissionUnknown} aria-busy={!isReady || !v2Ready} className="min-w-0">

          {/* Step 1: 基本情報 */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="reg-facility-name" className="form-label">施設名 <span className="text-red-500">*</span></label>
                <input {...register('facility_name')} id="reg-facility-name" className="form-input" placeholder="リラクゼーションサロン ABC" aria-required="true" maxLength={200} />
                {errors.facility_name && <p className="form-error" role="alert">{errors.facility_name.message}</p>}
              </div>
              <div>
                <label htmlFor="reg-business-type" className="form-label">業種 <span className="text-red-500">*</span></label>
                <select {...register('business_type')} id="reg-business-type" className="form-input" aria-required="true">
                  <option value="">選択してください</option>
                  {businessTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {errors.business_type && <p className="form-error" role="alert">{errors.business_type.message}</p>}
              </div>
              {/* PC・iPad では対になる項目を横に並べる。縦一列のままだと画面が広いほど
                  間延びして、入力の終わりが見えない（実機の 1440px / 834px で確認）。 */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="reg-rep-name" className="form-label">代表者名 <span className="text-red-500">*</span></label>
                  <input {...register('representative_name')} id="reg-rep-name" className="form-input" placeholder="山田 太郎" aria-required="true" />
                  {errors.representative_name && <p className="form-error" role="alert">{errors.representative_name.message}</p>}
                </div>
                <div>
                  <label htmlFor="reg-contact-name" className="form-label">担当者名 <span className="text-red-500">*</span></label>
                  <input {...register('contact_name')} id="reg-contact-name" className="form-input" placeholder="山田 花子" aria-required="true" />
                  {errors.contact_name && <p className="form-error" role="alert">{errors.contact_name.message}</p>}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="reg-email" className="form-label">メールアドレス <span className="text-red-500">*</span></label>
                  <input {...register('email')} id="reg-email" type="email" autoComplete="email" className="form-input" placeholder="example@email.com" aria-required="true" />
                  {errors.email && <p className="form-error" role="alert">{errors.email.message}</p>}
                </div>
                <div>
                  <label htmlFor="reg-phone" className="form-label">電話番号 <span className="text-red-500">*</span></label>
                  <input {...register('phone')} id="reg-phone" onChange={handlePhoneChange('phone')} autoComplete="tel" className="form-input" placeholder="090-1234-5678" aria-required="true" maxLength={20} />
                  {errors.phone && <p className="form-error" role="alert">{errors.phone.message}</p>}
                </div>
              </div>
              {/* 任意項目は既定で畳む。必須と同じ見た目で並べると、スマホでは入力欄の壁にしか
                  見えず「まだこんなにあるのか」と離脱を招く。details は閉じていても中身が
                  DOM に在るため、react-hook-form の登録も検証も従来どおり効く。 */}
              <details className="group border border-[var(--ecru-line)] bg-[var(--ecru-bg)]/70 px-4 py-3">
                <summary className="cursor-pointer list-none text-xs font-medium text-[var(--ecru-muted)] marker:content-none">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-base leading-none text-[var(--ecru-line)] transition-transform group-open:rotate-45">+</span>
                    直通電話・Webサイトを追加する
                  </span>
                </summary>
                <div className="mt-4 space-y-4">
                  <div>
                    <label htmlFor="reg-contact-phone" className="form-label">担当者直通電話</label>
                    <input {...register('contact_phone')} id="reg-contact-phone" onChange={handlePhoneChange('contact_phone')} maxLength={20} className="form-input" placeholder="090-1234-5678" />
                    {errors.contact_phone && <p className="form-error" role="alert">{errors.contact_phone.message}</p>}
                  </div>
                  <div>
                    <label htmlFor="reg-website" className="form-label">WebサイトURL</label>
                    <input {...register('website')} id="reg-website" type="url" className="form-input" placeholder="https://example.com" maxLength={2000} />
                    {errors.website && <p className="form-error" role="alert">{errors.website.message}</p>}
                  </div>
                </div>
              </details>
              <button type="button" onClick={nextStep} className="btn-primary w-full !py-3">次へ</button>
            </div>
          )}

          {/* Step 2: 詳細情報 */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="reg-postal-code" className="form-label">郵便番号 <span className="text-gray-400 text-xs font-normal">7桁入力で住所を自動補完</span></label>
                <input {...register('postal_code')} id="reg-postal-code" autoComplete="postal-code" className="form-input" placeholder="5600001" maxLength={8} inputMode="numeric" />
                {errors.postal_code && <p className="form-error" role="alert">{errors.postal_code.message}</p>}
              </div>
              <div>
                <label htmlFor="reg-address" className="form-label">住所</label>
                <input {...addressRegistration} onChange={event => {
                  handleAddressChange();
                  void addressRegistration.onChange(event);
                }} id="reg-address" autoComplete="street-address" className="form-input" placeholder="大阪府堺市堺区…" maxLength={500} />
                {errors.address && <p className="form-error" role="alert">{errors.address.message}</p>}
              </div>
              <details className="group border border-[var(--ecru-line)] bg-[var(--ecru-bg)]/70 px-4 py-3">
                <summary className="cursor-pointer list-none text-xs font-medium text-[var(--ecru-muted)] marker:content-none">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-base leading-none text-[var(--ecru-line)] transition-transform group-open:rotate-45">+</span>
                    建物名・最寄り駅を追加する
                  </span>
                </summary>
                <div className="mt-4 space-y-4">
                  <div>
                    <label htmlFor="reg-building-name" className="form-label">建物名・部屋番号</label>
                    <input {...register('building_name')} id="reg-building-name" className="form-input" placeholder="○○ビル 3F" maxLength={200} />
                    {errors.building_name && <p className="form-error" role="alert">{SALON_FIELD_MESSAGES.building_name}</p>}
                  </div>
                  <div>
                    <label htmlFor="reg-nearest-station" className="form-label">最寄り駅</label>
                    <input {...register('nearest_station')} id="reg-nearest-station" className="form-input" placeholder="堺東駅 徒歩5分" maxLength={200} />
                    {errors.nearest_station && <p className="form-error" role="alert">{SALON_FIELD_MESSAGES.nearest_station}</p>}
                  </div>
                </div>
              </details>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="reg-business-hours" className="form-label">営業時間</label>
                  <input {...register('business_hours')} id="reg-business-hours" className="form-input" placeholder="10:00〜20:00" maxLength={200} />
                  {errors.business_hours && <p className="form-error" role="alert">{SALON_FIELD_MESSAGES.business_hours}</p>}
                </div>
                <div>
                  <label htmlFor="reg-regular-holiday" className="form-label">定休日</label>
                  <input {...register('regular_holiday')} id="reg-regular-holiday" className="form-input" placeholder="毎週月曜日" maxLength={200} />
                  {errors.regular_holiday && <p className="form-error" role="alert">{SALON_FIELD_MESSAGES.regular_holiday}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="reg-seat-count" className="form-label">席数・ベッド数</label>
                  <input {...register('seat_count', { valueAsNumber: true })} id="reg-seat-count" type="number" min="0" max="9999" step="1" className="form-input" />
                  {errors.seat_count && <p className="form-error" role="alert">{SALON_FIELD_MESSAGES.seat_count}</p>}
                </div>
                <div>
                  <label htmlFor="reg-staff-count" className="form-label">スタッフ数</label>
                  <input {...register('staff_count', { valueAsNumber: true })} id="reg-staff-count" type="number" min="0" max="9999" step="1" className="form-input" />
                  {errors.staff_count && <p className="form-error" role="alert">{SALON_FIELD_MESSAGES.staff_count}</p>}
                </div>
              </div>
              <div>
                <label className="form-label flex items-center gap-2 cursor-pointer">
                  <input {...register('has_parking')} type="checkbox" className="w-4 h-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500" />
                  駐車場あり
                </label>
                {errors.has_parking && <p className="form-error" role="alert">{SALON_FIELD_MESSAGES.has_parking}</p>}
              </div>
              <div>
                <label className="form-label">こだわり・特徴 <span className="text-gray-400 text-xs font-normal">複数選択可</span></label>
                <div className="flex flex-wrap gap-2" role="group" aria-label="こだわり・特徴" tabIndex={-1} data-field="features">
                  {facilityFeatures.map(f => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => toggleFeature(f)}
                      aria-pressed={selectedFeatures.includes(f)}
                      className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                        selectedFeatures.includes(f)
                          ? 'bg-sky-50 border-sky-400 text-sky-700'
                          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {selectedFeatures.includes(f) && <span className="mr-1">&#10003;</span>}
                      {f}
                    </button>
                  ))}
                </div>
                {errors.features && <p className="form-error" role="alert">{SALON_FIELD_MESSAGES.features}</p>}
              </div>
              <div className="flex gap-4">
                <button type="button" onClick={() => setStep(1)} className="btn-outline flex-1">戻る</button>
                <button type="button" onClick={nextStep} className="btn-primary flex-1">次へ</button>
              </div>
            </div>
          )}

          {/* Step 3: PR情報 */}
            <div className="space-y-4" hidden={step !== 3}>
              <div>
                <label htmlFor="reg-pr-text" className="form-label">PR文 <span className="text-gray-400 text-xs font-normal">1000文字以内</span></label>
                <textarea {...register('pr_text')} id="reg-pr-text" className="form-input min-h-[150px]" placeholder="お店の魅力を自由にご記入ください" maxLength={1000} />
                <div className="flex justify-between mt-1">
                  {errors.pr_text && <p className="form-error" role="alert">{errors.pr_text.message}</p>}
                  <p className="text-sm text-gray-400 ml-auto">{prText.length}/1000</p>
                </div>
              </div>
              <div>
                <label className="form-label">施設写真 <span className="text-gray-400 text-xs font-normal">受付時は任意・最大7枚。公開時には写真の設定が必要です</span></label>
                <MultiPhotoUpload slots={photoSlots} onChange={setPhotoFiles} />
                {photoError && <p className="form-error" role="alert">{photoError}</p>}
              </div>
              <div>
                <label htmlFor="reg-desired-start-date" className="form-label">掲載希望時期</label>
                <select {...register('desired_start_date')} id="reg-desired-start-date" className="form-input">
                  {startDateOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {errors.desired_start_date && <p className="form-error" role="alert">{SALON_FIELD_MESSAGES.desired_start_date}</p>}
              </div>
              <label className="flex items-start gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={licenseWarranted}
                  onChange={(e) => setLicenseWarranted(e.target.checked)}
                  className="mt-0.5 rounded border-gray-300"
                />
                <span>
                  当施設の運営に法令上必要な許可・免許・届出（美容所開設届、施術所開設届、診療所開設届等）を
                  すべて完了しており、施術は必要な資格を有する者が提供することを表明します（必須）
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 rounded border-gray-300"
                />
                <span>
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline">利用規約</a>
                  および
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline">プライバシーポリシー</a>
                  に同意する（必須）
                </span>
              </label>
              <div className="flex gap-4">
                <button type="button" onClick={() => setStep(2)} className="btn-outline flex-1">戻る</button>
                <button type="submit" disabled={submitting || submissionUnknown || !agreed || !licenseWarranted} className="btn-primary flex-1 !py-3">
                  {submitting ? <span className="flex items-center justify-center gap-2"><Spinner />送信中...</span> : '登録する'}
                </button>
              </div>
            </div>
          </fieldset>
        </form>
      </div>

      <ConfirmDialog
        open={showConfirm}
        title="登録内容を送信しますか？"
        message="送信後、続けてアカウントを作成すると、入力内容（営業時間・写真・特徴・PRなど）がそのまま管理画面に反映され、すぐに掲載を開始できます。"
        confirmLabel="送信する"
        cancelLabel="戻る"
        confirmDisabled={submitting || submissionUnknown}
        onConfirm={handleConfirmSubmit}
        onCancel={() => setShowConfirm(false)}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
