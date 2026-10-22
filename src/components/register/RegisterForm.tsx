'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm, useWatch, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import { salonStep1Schema, salonStep2Schema, salonStep3Schema, salonFullSchema, type SalonFormValues, businessTypes } from '@/lib/validations';
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
import { exportSalonDraftBackup, importSalonDraftBackup } from '@/lib/salon-draft-backup';
import { readSalonBrowserContext, SALON_COMPLETE_PATH } from '@/lib/salon-browser-context';
import { SalonLocalDraftControls, DRAFT_BUTTON, type SalonLocalDraftHandle } from '@/components/register/SalonLocalDraftControls';
import { readLocalSalonDraft } from '@/lib/salon-local-draft';
import { normalizePostalCodeInput, normalizeWebsiteInput } from '@/lib/register-input-normalize';
import { REGISTER_PHOTO_FIELD_NOTE } from '@/lib/register-photo-policy';

const stepSchemas = [salonStep1Schema, salonStep2Schema, salonStep3Schema];
const stepLabels = ['基本情報', '詳細情報', 'PR情報'];

// 「駐車場あり」は専用のチェックボックス（has_parking）があるので、こだわりチップからは外す
// （同じ意味の入力が 2 つ並んでいた）。検索の絞り込みは features 配列を見るため、
// チェックボックスの状態を features にも反映して送る（従来どおり見つかるようにする）。
const PARKING_FEATURE = '駐車場あり';
const featureChoices = facilityFeatures.filter(feature => feature !== PARKING_FEATURE);

const LEAVE_CONFIRM_MESSAGE = '入力中の内容は送信されていません。このページを離れると入力が失われます。';

// 入力欄にフォーカスが移ったとき（エラー箇所へ移すときなど）、固定ヘッダー（4rem）の下に
// 隠れないよう余白を取る。
const FIELD_SCROLL_MARGIN = '[&_input]:scroll-mt-24 [&_select]:scroll-mt-24 [&_textarea]:scroll-mt-24 [&_fieldset]:scroll-mt-24';

const STEP_BUTTON = 'min-h-12 py-2!';
const CHECKBOX = 'mt-0.5 size-5 shrink-0 rounded-sm border-gray-300 accent-(--ecru-accent)';

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


const emptySalonValues: SalonFormValues = {
  facility_name: '', business_type: '', representative_name: '', contact_name: '',
  email: '', phone: '', contact_phone: '', website: '',
  postal_code: '', address: '', prefecture: null, city: null, building_name: '', nearest_station: '',
  business_hours: '', regular_holiday: '', seat_count: null, staff_count: null,
  has_parking: false, features: [],
  pr_text: '', desired_start_date: '',
};

function createRegistrationBrowser() {
  return new SalonRegistrationBrowser({
    store: window.sessionStorage, request: fetch, uuid: () => crypto.randomUUID(),
    captcha: () => getRecaptchaToken('salons'), compress: compressImage,
    upload: async (bucket, path, token, file) => supabase.storage.from(bucket)
      .uploadToSignedUrl(path, token, file, { contentType: file.type }),
  });
}

// A generic upload/network failure is not evidence of a policy cutover.
function isLegacyStoragePolicyRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; statusCode?: unknown; status?: unknown; message?: unknown };
  return value.code === '42501' || ((value.statusCode === '403' || value.statusCode === 403 || value.status === 403)
    && typeof value.message === 'string' && /row[ -]level security|row[ -]level.*policy/i.test(value.message));
}

function readDraftContext() {
  try { return readSalonBrowserContext(window.sessionStorage); }
  catch { return { state: 'unavailable' } as const; }
}

export default function RegisterForm({ v2Enabled = false }: { v2Enabled?: boolean }) {
  const router = useRouter();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [step, setStep] = useState(1);
  const [pendingFocus, setPendingFocus] = useState<{ field: keyof SalonFormValues } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submissionUnknown, setSubmissionUnknown] = useState(false);
  const submissionUnknownRef = useRef(false);
  const [submissionConfirmed, setSubmissionConfirmed] = useState(false);
  const submissionConfirmedRef = useRef(false);
  const v2 = useRef<SalonRegistrationBrowser | null>(null);
  const localDraft = useRef<SalonLocalDraftHandle | null>(null);
  const [confirmedCleanupPath, setConfirmedCleanupPath] = useState<string | null>(null);
  const [useV2, setUseV2] = useState(v2Enabled);
  const [v2Ready, setV2Ready] = useState(false);
  const [v2Message, setV2Message] = useState('');
  const addressLookupGeneration = useRef(0);
  const restoredPostalCode = useRef<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const draftLockRef = useRef(false);
  const [draftContext, setDraftContext] = useState<'empty' | 'prepared' | 'locked'>('locked');
  const [restoreGeneration, setRestoreGeneration] = useState(0);
  const [restoredNeedsReview, setRestoredNeedsReview] = useState(false);
  const [restoredUnsentAcknowledged, setRestoredUnsentAcknowledged] = useState(false);
  const [legacyStorageBlocked, setLegacyStorageBlocked] = useState(false);
  const [photoFiles, setPhotoFiles] = useState<(File | null)[]>(photoSlots.map(() => null));
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [agreed, setAgreed] = useState(false);
  // 【2026年7月29日】許認可・届出の表明保証（利用規約 第12条）。規約への一括同意とは別建てにする。
  // 一括同意に埋めると「読んでいない・気づいていない」の余地が残り、責任分界の証跡として弱い。
  // 独立したチェックにすることで、掲載者が届出義務を認識した上で登録した事実を明確に残す。
  const [licenseWarranted, setLicenseWarranted] = useState(false);
  // 担当者が代表者と同じなら入力欄を出さず、同じ値を送る（API は両方を必須で受け取るため、
  // contact_name も必ず埋めて送る）。既定で同じ扱いにして、入力を 1 つ減らす。
  const [contactSameAsRep, setContactSameAsRep] = useState(true);
  // 「登録する」を押したあとだけ、未チェックの同意に理由を出す（開いた瞬間から赤くしない）。
  const [consentAttempted, setConsentAttempted] = useState(false);
  // 「次へ」で検証に落ちたステップ。要約（role=alert）はこのステップの間に 1 つだけ出す。
  const [failedStep, setFailedStep] = useState<number | null>(null);
  const [draftPanelOpen, setDraftPanelOpen] = useState(false);
  const [stepFocusRequest, setStepFocusRequest] = useState(0);
  const stepStatusRef = useRef<HTMLParagraphElement>(null);
  // アプリ内リンクで離れようとしたときの移動先（確認ダイアログで「移動する」を選ぶまで保留）。
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);

  const { register, handleSubmit, trigger, setValue, setError, getFieldState, getValues, watch, control, reset, formState: { errors, isReady } } = useForm<SalonFormValues>({
    resolver: zodResolver(salonFullSchema),
    mode: 'onTouched',
    defaultValues: emptySalonValues,
  });

  const prText = useWatch({ control, name: 'pr_text' }) || '';
  const postalCode = useWatch({ control, name: 'postal_code' }) || '';
  const selectedFeatures = useWatch({ control, name: 'features' }) || [];
  const representativeName = useWatch({ control, name: 'representative_name' }) || '';
  const hasParking = useWatch({ control, name: 'has_parking' }) || false;
  const addressRegistration = register('address');
  const completeConfirmedRegistration = useCallback(async (path: string) => {
    try { await localDraft.current?.confirmed(); }
    catch {
      // Local cleanup failure cannot turn a verified receipt into an unknown
      // submission. Stay here with its fence and an explicit receipt link.
      setConfirmedCleanupPath(path);
      // 案内文が指す「端末の下書きを削除」は畳んだ操作欄の中にあるので、開いて見せる。
      setDraftPanelOpen(true);
      return;
    }
    router.push(path);
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      if (submissionConfirmedRef.current) return;
      // The flag controls new registrations, not previously issued capabilities.
      // Check saved progress before allowing V1 input after a V2 rollback.
      const context = readDraftContext();
      setDraftContext(context.state === 'empty' ? 'empty' : context.state === 'ready' && context.context.phase === 'prepared' ? 'prepared' : 'locked');
      if (!v2Enabled && context.state === 'empty') {
        setV2Ready(true);
        return;
      }
      setUseV2(true);
      if (!v2.current) v2.current = createRegistrationBrowser();
      const result = await v2.current.reconcile();
      if (cancelled || submissionConfirmedRef.current) return;
      if (result.state === 'confirmed') {
        submissionConfirmedRef.current = true; setSubmissionConfirmed(true); await completeConfirmedRegistration(SALON_COMPLETE_PATH);
      }
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
  }, [v2Enabled, completeConfirmedRegistration]);

  const acceptV2Result = async (result: Awaited<ReturnType<SalonRegistrationBrowser['submit']>>) => {
    const context = readDraftContext();
    setDraftContext(context.state === 'empty' ? 'empty' : context.state === 'ready' && context.context.phase === 'prepared' ? 'prepared' : 'locked');
    if (result.state === 'confirmed') {
      submissionConfirmedRef.current = true; setSubmissionConfirmed(true); setIsDirty(false); await completeConfirmedRegistration(SALON_COMPLETE_PATH);
    }
    else if (result.state === 'ready' || result.state === 'retryable') {
      submissionUnknownRef.current = false; setSubmissionUnknown(false); setV2Ready(true);
      if (result.state === 'retryable') {
        if (v2.current?.canReviseUnsubmittedInput()) {
          try { await localDraft.current?.rejectedBeforeCommit(); } catch { /* Local controls keep their fence and show the failure. */ }
        }
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
    try { await acceptV2Result(await v2.current.retryUnknown()); }
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
        if (field === 'contact_name') setContactSameAsRep(false);
        setFailedStep(index + 1);
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

  // 入力中は書き換えない（自動でハイフンを入れると 0120・4桁の市外局番を誤って区切り、
  // 利用者が打った区切りも上書きしていた）。欄を離れたときに全角→半角・ダッシュの統一だけ行う。
  // 送信値の正規化は phoneField（zod の transform）が必ず行う。
  const normalizedOnBlur = (field: 'phone' | 'contact_phone' | 'postal_code' | 'website', normalize: (value: string) => string) => {
    const registration = register(field, field === 'postal_code' ? { setValueAs: normalizePostalCodeInput }
      : field === 'website' ? { setValueAs: normalizeWebsiteInput } : undefined);
    return {
      ...registration,
      onBlur: (event: React.FocusEvent<HTMLInputElement>) => {
        const normalized = normalize(event.target.value);
        if (normalized !== event.target.value) setValue(field, normalized);
        return registration.onBlur(event);
      },
    };
  };

  // Postal responses are suggestions tied to the input generation, never an
  // authority to overwrite a newer postcode or a manually corrected address.
  useEffect(() => {
    const generation = ++addressLookupGeneration.current;
    const digits = postalCode.replace(/\D/g, '');
    if (restoredPostalCode.current === digits) return;
    restoredPostalCode.current = null;
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

  // beforeunload は再読み込み・タブを閉じる・外部サイトへの移動しか止めない。ヘッダーの
  // ロゴやナビなどアプリ内リンクはクライアント遷移なので、入力が無言で失われていた。
  // 入力途中のときだけ、アプリ内リンクの押下を捕まえて確認する（新しいタブ・修飾キー付き・
  // 同じページ内のアンカーは対象外）。送信済み・結果不明のときは確認しない。
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: MouseEvent) => {
      if (submissionUnknownRef.current || submissionConfirmedRef.current) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveTarget(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [isDirty]);

  const handleFieldChange = () => { if (!isDirty) setIsDirty(true); };

  // 「代表者と同じ」のあいだは担当者名を代表者名に追従させる（入力欄は出さない）。
  useEffect(() => {
    if (!contactSameAsRep || getValues('contact_name') === representativeName) return;
    setValue('contact_name', representativeName);
  }, [contactSameAsRep, representativeName, getValues, setValue]);

  // 駐車場のチェックボックスを、検索が見る features 側にも反映する（チップは出さない）。
  useEffect(() => {
    const current = getValues('features') || [];
    if (hasParking === current.includes(PARKING_FEATURE)) return;
    setValue('features', hasParking ? [...current, PARKING_FEATURE] : current.filter(feature => feature !== PARKING_FEATURE));
  }, [hasParking, getValues, setValue]);

  // ステップを切り替えたら、見出し（ステップ n/3）へ移ってそこから読ませる。従来はフォーカスが
  // body に落ち、画面もページ途中に残ったまま（どこから読めばよいか分からない）だった。
  useEffect(() => {
    if (!stepFocusRequest) return;
    const status = stepStatusRef.current;
    if (!status) return;
    status.scrollIntoView?.({ block: 'start' });
    status.focus({ preventScroll: true });
  }, [stepFocusRequest]);

  const goToStep = (next: number) => {
    setStep(next);
    setStepFocusRequest(value => value + 1);
  };

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
    if (await trigger(fields)) { setFailedStep(null); goToStep(step + 1); }
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
    if (submissionUnknownRef.current || submissionConfirmedRef.current || draftLockRef.current || !agreed || !licenseWarranted || (restoredNeedsReview && !restoredUnsentAcknowledged)) return;
    if (!useV2 && readDraftContext().state !== 'empty') {
      submissionUnknownRef.current = true; setSubmissionUnknown(true); return;
    }
    setSubmitting(true);
    setPhotoError(null);
    try {
      if (!(await localDraft.current?.beforeSubmit(data, photoFiles))) { setSubmitting(false); return; }
    } catch {
      setSubmitting(false); setToast({ type: 'error', message: '端末の下書きを確認できませんでした。送信せず、入力と元の写真を保持しています。' }); return;
    }
    if (useV2) {
      try {
        if (!v2.current) throw new Error('Registration context unavailable');
        await acceptV2Result(await v2.current.submit(data, photoFiles, { terms_agreed: agreed, license_warranted: licenseWarranted }));
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
    const policyRejections = new Set<unknown>();
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
          if (uploadError) {
            if (isLegacyStoragePolicyRejection(uploadError)) policyRejections.add(uploadError);
            throw uploadError;
          }
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
          consent: { terms_agreed: agreed, license_warranted: licenseWarranted },
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

      submissionConfirmedRef.current = true; setSubmissionConfirmed(true);
      setIsDirty(false);
      // 【2026年7月8日 恒久根治】/register/complete はクライアント供給の name/type/area だけを表示
      // しており、サーバー確認なしで誰でも任意の値を使って「登録完了しました」画面を直接開けた
      // （実登録なしでの偽装表示・分析上のコンバージョン計測歪みの懸念）。/api/salons が返す
      // salon id を渡し、complete ページ側でその id が実在する登録データか検証してから
      // サーバー側の実データを表示する方式に変更する。
      const params = new URLSearchParams();
      params.set('id', result.id);
      await completeConfirmedRegistration(`/register/complete?${params.toString()}`);
    } catch (e) {
      if (!requestStarted || confirmedRejection) {
        if (!requestStarted) {
          try { await localDraft.current?.rejectedBeforeCommit(); } catch { /* Do not weaken the local submission fence. */ }
        }
        if (!requestStarted && policyRejections.has(e) && isLegacyStoragePolicyRejection(e)) setLegacyStorageBlocked(true);
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
    if (submitLockRef.current || submissionUnknownRef.current || submissionConfirmedRef.current || draftLockRef.current || (restoredNeedsReview && !restoredUnsentAcknowledged)) return;
    submitLockRef.current = true;
    setShowConfirm(false);
    handleSubmit(onSubmit, revealErrors)().finally(() => {
      submitLockRef.current = false;
    });
  };

  const draftAllowed = (restoring: boolean) => {
    if (submitLockRef.current || draftLockRef.current || submissionUnknownRef.current || submissionConfirmedRef.current || submitting) return false;
    const context = readDraftContext();
    setDraftContext(context.state === 'empty' ? 'empty' : context.state === 'ready' && context.context.phase === 'prepared' ? 'prepared' : 'locked');
    if (context.state === 'unavailable' || (context.state === 'ready' && (restoring || context.context.phase !== 'prepared'))) return false;
    return true;
  };

  const downloadDraft = async () => {
    if (!draftAllowed(false)) { setToast({ type: 'error', message: '送信状況を確認するまでバックアップできません。受付状況をお問い合わせください。' }); return; }
    draftLockRef.current = true; setDraftBusy(true);
    let url: string | null = null;
    let anchor: HTMLAnchorElement | null = null;
    try {
      const backup = await exportSalonDraftBackup(getValues(), photoFiles);
      if (!mounted.current) return;
      // Serialization must not race a submission or a changed browser context.
      const context = readDraftContext();
      setDraftContext(context.state === 'empty' ? 'empty' : context.state === 'ready' && context.context.phase === 'prepared' ? 'prepared' : 'locked');
      if (submissionUnknownRef.current || submissionConfirmedRef.current || submitLockRef.current || context.state === 'unavailable'
        || (context.state === 'ready' && context.context.phase !== 'prepared')) throw new Error('backup blocked');
      url = URL.createObjectURL(backup);
      anchor = document.createElement('a'); anchor.href = url; anchor.download = 'carelink-draft.json';
      document.body.appendChild(anchor); anchor.click();
      setToast({ type: 'success', message: 'バックアップファイルを作成しました。保存先をご確認ください。' });
    } catch {
      setToast({ type: 'error', message: 'バックアップを保存できませんでした。入力と元の写真はこの画面に保持されています。' });
    } finally {
      anchor?.remove();
      if (url) {
        const objectUrl = url; const revoke = URL.revokeObjectURL.bind(URL);
        window.setTimeout(() => revoke(objectUrl), 1000);
      }
      draftLockRef.current = false; setDraftBusy(false);
    }
  };

  const restoreDraft = async (file: File, fromLocal = false) => {
    if (!draftAllowed(true)) { setToast({ type: 'error', message: '既存の申込または送信状況を確認するまで復元できません。受付状況をお問い合わせください。' }); return false; }
    draftLockRef.current = true; setDraftBusy(true);
    try {
      const local = await readLocalSalonDraft();
      if (local?.state === 'locked') throw new Error('Submitted local draft remains fenced');
      const draft = await importSalonDraftBackup(file);
      if (!mounted.current) return;
      const currentLocal = await readLocalSalonDraft();
      if (currentLocal?.state === 'locked') throw new Error('Local draft was fenced while decoding backup');
      if (!fromLocal && !(await localDraft.current?.adoptManualBackup(file))) throw new Error('Portable backup cannot bypass another local draft');
      const context = readDraftContext();
      setDraftContext(context.state === 'empty' ? 'empty' : context.state === 'ready' && context.context.phase === 'prepared' ? 'prepared' : 'locked');
      if (context.state !== 'empty' || submissionUnknownRef.current || submissionConfirmedRef.current || submitLockRef.current) throw new Error('restore blocked');
      // Decode and verify every file before changing any visible input.
      const values = { ...emptySalonValues, ...draft.values };
      for (const field of Object.keys(salonFullSchema.shape) as (keyof SalonFormValues)[]) {
        if (values[field] === undefined || values[field] === null) {
          if (!['prefecture', 'city', 'seat_count', 'staff_count'].includes(field)) {
            Object.assign(values, { [field]: field === 'features' ? [] : field === 'has_parking' ? false : '' });
          }
        }
      }
      // 旧画面の下書きは「駐車場あり」をチップでも持てた。チェックボックスと features を揃える。
      const restoredParking = Boolean(values.has_parking) || (values.features || []).includes(PARKING_FEATURE);
      values.has_parking = restoredParking;
      if (restoredParking && !(values.features || []).includes(PARKING_FEATURE)) values.features = [...(values.features || []), PARKING_FEATURE];
      addressLookupGeneration.current++;
      restoredPostalCode.current = (values.postal_code || '').replace(/\D/g, '');
      reset(values);
      setContactSameAsRep(values.contact_name === values.representative_name);
      setConsentAttempted(false); setFailedStep(null);
      setPhotoFiles(draft.photos); setRestoreGeneration(value => value + 1);
      setAgreed(false); setLicenseWarranted(false); setRestoredNeedsReview(true); setRestoredUnsentAcknowledged(false);
      setLegacyStorageBlocked(false); setShowConfirm(false); setPhotoError(null); setIsDirty(true); setStep(1);
      setToast({ type: 'success', message: '入力と元の写真を復元しました。内容と未送信であることを確認し、規約と表明に改めて同意してください。' });
      return true;
    } catch {
      setToast({ type: 'error', message: '下書きを復元できませんでした。入力と元の写真は変更されていません。' });
      return false;
    } finally { draftLockRef.current = false; setDraftBusy(false); }
  };

  const retrySignedUpload = () => {
    if (!legacyStorageBlocked || submitLockRef.current || draftLockRef.current || submissionUnknownRef.current || submissionConfirmedRef.current || submitting
      || !agreed || !licenseWarranted || (restoredNeedsReview && !restoredUnsentAcknowledged)) return;
    // The click authorizes a new signed attempt only after V1 failed before its POST.
    const context = readDraftContext();
    if (context.state !== 'empty') { setToast({ type: 'error', message: '既存の申込の受付状況を先に確認してください。' }); return; }
    submitLockRef.current = true; setSubmitting(true); setShowConfirm(false);
    void handleSubmit(async data => {
      try {
        if (!v2.current) v2.current = createRegistrationBrowser();
        if (!(await localDraft.current?.beforeSubmit(data, photoFiles))) return;
        setUseV2(true); setLegacyStorageBlocked(false);
        await acceptV2Result(await v2.current.submit(data, photoFiles, { terms_agreed: agreed, license_warranted: licenseWarranted }));
      } catch {
        submissionUnknownRef.current = true; setSubmissionUnknown(true); setV2Message(SALON_SUBMISSION_UNKNOWN);
      }
    }, revealErrors)().finally(() => { submitLockRef.current = false; setSubmitting(false); });
  };

  const backupDisabled = !isReady || !v2Ready || submitting || draftBusy || submissionUnknown || submissionConfirmed || draftContext === 'locked';
  const restoreDisabled = backupDisabled || draftContext !== 'empty';

  // 必須のチェック（復元した下書きの未送信確認・表明保証・規約同意）。押せない理由を示さずに
  // 「登録する」を無効化していたため、何が足りないのか分からなかった。ボタンは押せるままにし、
  // 押したときに未チェックの項目へ理由を出してフォーカスを移す（送信は従来どおり止める）。
  const requiredChecks = [
    { key: 'unsent', id: 'reg-unsent-ack', needed: restoredNeedsReview, checked: restoredUnsentAcknowledged, message: '未送信であることの確認にチェックしてください' },
    { key: 'license', id: 'reg-license', needed: true, checked: licenseWarranted, message: '許可・届出の表明にチェックしてください' },
    { key: 'terms', id: 'reg-terms', needed: true, checked: agreed, message: '利用規約とプライバシーポリシーへの同意にチェックしてください' },
  ] as const;
  const missingChecks = requiredChecks.filter(check => check.needed && !check.checked);
  const checkError = (key: (typeof requiredChecks)[number]['key']) =>
    consentAttempted ? missingChecks.find(check => check.key === key)?.message : undefined;

  const requestConfirm = handleSubmit(() => {
    if (missingChecks.length > 0) {
      document.getElementById(missingChecks[0].id)?.focus();
      return;
    }
    setShowConfirm(true);
  }, revealErrors);

  /** 入力欄とエラー文を結ぶ（aria-invalid・aria-describedby）。エラー文は欄ごとに 1 つ。 */
  const describe = (field: keyof SalonFormValues, id: string) => errors[field]
    ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` }
    : {};
  const fieldError = (field: keyof SalonFormValues, id: string, message?: string) => errors[field]
    ? <p id={`${id}-error`} className="form-error">{message ?? errors[field]?.message}</p>
    : null;
  // 同時に何件も role=alert を出すと読み上げが重なる。「次へ」で止まったときだけ、件数の要約を 1 つ出す。
  const stepErrorCount = (Object.keys(stepSchemas[step - 1].shape) as (keyof SalonFormValues)[])
    // 「代表者と同じ」の間の担当者名は代表者名の写しなので、同じ不備を二重に数えない。
    .filter(field => errors[field] && !(field === 'contact_name' && contactSameAsRep)).length;

  const chevron = (
    <svg aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-(--ecru-muted)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );

  return (
    <div className="mx-auto max-w-[640px] sm:px-12">
      <div>
        <StepIndicator currentStep={step} totalSteps={3} labels={stepLabels} statusRef={stepStatusRef} />
        {/* 下書き・バックアップは任意の機能。最初の入力欄より前に長い説明と操作を並べると、
            申し込みそのものが始めにくい（実機で入力欄が画面外へ押し出されていた）。
            1 行に畳み、必要なとき（端末に下書きがある・保存に失敗した）だけ自動で開く。 */}
        <details id="register-draft-tools" open={draftPanelOpen} onToggle={event => setDraftPanelOpen(event.currentTarget.open)}
          className="group mb-6 border-y border-(--ecru-line) bg-(--ecru-surface) sm:border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm text-(--ecru-text) marker:content-none">
            <span aria-hidden="true" className="text-base leading-none text-(--ecru-muted) transition-transform group-open:rotate-45">+</span>
            入力途中の内容を保存する（任意）
          </summary>
          <div className="space-y-6 border-t border-(--ecru-line) px-4 py-4">
            <SalonLocalDraftControls ref={localDraft} getValues={getValues} watch={watch} photos={photoFiles}
              canSave={() => !backupDisabled && (() => { const context = readDraftContext(); return context.state === 'empty' || (context.state === 'ready' && context.context.phase === 'prepared'); })()}
              canRestore={() => !restoreDisabled && readDraftContext().state === 'empty'}
              onAttention={() => setDraftPanelOpen(true)}
              onRestore={async blob => { if (!(await restoreDraft(new File([blob], 'carelink-local-draft.json', { type: 'application/json' }), true))) throw new Error('Local draft restoration not confirmed'); }} />
            <section aria-label="入力の手動バックアップ" className="text-sm">
              <h3 className="font-medium">ファイルに保存する</h3>
              <p className="mt-1 text-(--ecru-muted)">未送信の入力と元の写真を、ファイルへ手動で保存・復元できます。端末への自動保存は、上の「この端末で下書きを自動保存する」を選んだ場合だけ行います。</p>
              <p className="mt-1 text-(--ecru-muted)">ファイルには氏名・連絡先・写真が含まれます。安全な保存先で管理し、共有端末では保存しないでください。不要になったら削除してください。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void downloadDraft()} disabled={backupDisabled} className={DRAFT_BUTTON}>入力と元の写真をバックアップ</button>
                {/* ファイル選択欄は sr-only（「Choose File」等のブラウザー既定の英語表示を出さない）。
                    キーボードではこの欄にフォーカスが入るので、枠に focus-within でリングを出す。 */}
                <label className={`${DRAFT_BUTTON} focus-within:ring-2 focus-within:ring-(--primary) focus-within:ring-offset-2 ${restoreDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                  バックアップから入力を復元
                  <input type="file" accept="application/json,.json" aria-label="バックアップから入力を復元" disabled={restoreDisabled} className="sr-only"
                    onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void restoreDraft(file); }} />
                </label>
              </div>
              {draftContext !== 'empty' && <p className="mt-2">既存の申込確認情報があるため復元できません。送信済み・結果不明の場合は、受付状況を先に確認してください。</p>}
            </section>
          </div>
        </details>
        {confirmedCleanupPath && <div role="alert" className="mb-4 rounded-sm border p-4 text-sm">
          <p>掲載申込の受付は確認済みです。この端末の下書き削除を確認できませんでした。下書きの復元はロックされています。「端末の下書きを削除」をお試しください。</p>
          <Link href={confirmedCleanupPath} className="mt-2 inline-block underline">受付内容を確認する</Link>
        </div>}
        {legacyStorageBlocked && !submissionUnknown && <div role="alert" className="mb-4 rounded-sm border border-amber-300 p-4 text-sm">
          <p>写真の旧アップロード方法が利用できません。申込はまだ送信していません。入力と元の写真を保持したまま、安全なアップロードで明示的に再試行できます。</p>
          <button type="button" onClick={retrySignedUpload} disabled={submitting || draftBusy || !agreed || !licenseWarranted || (restoredNeedsReview && !restoredUnsentAcknowledged)}
            className="mt-3 underline">安全なアップロードで再試行</button>
        </div>}

        {submissionUnknown && (
          <div role="alert" className="mb-4 rounded-sm border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p>{useV2 ? v2Message : SALON_SUBMISSION_UNKNOWN}</p>
            {useV2 && <button type="button" onClick={() => void reconcileV2()} disabled={submitting}
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
        <form onSubmit={event => { if (step === 3) setConsentAttempted(true); void requestConfirm(event); }} onChange={handleFieldChange} noValidate
          className={`border-y border-(--ecru-line) bg-(--ecru-surface) px-5 py-7 sm:border sm:px-10 sm:py-10 ${FIELD_SCROLL_MARGIN}`}>
          {/* SSR中の入力をRHFの初期化が消さないよう、購読・refの準備完了まで操作を止める。 */}
          <fieldset disabled={!isReady || !v2Ready || submissionUnknown || submissionConfirmed || draftBusy || submitting} aria-busy={!isReady || !v2Ready} className="min-w-0">

          {failedStep === step && stepErrorCount > 0 && (
            <p role="alert" className="form-error mb-4 mt-0 font-medium">入力内容を確認してください（{stepErrorCount}件）</p>
          )}

          {/* Step 1: 基本情報 */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="reg-facility-name" className="form-label">施設名 <span className="text-red-600">*</span></label>
                <input {...register('facility_name')} id="reg-facility-name" autoComplete="organization" className="form-input" placeholder="リラクゼーションサロン ABC" aria-required="true" maxLength={200} {...describe('facility_name', 'reg-facility-name')} />
                {fieldError('facility_name', 'reg-facility-name')}
              </div>
              <div>
                <label htmlFor="reg-business-type" className="form-label">業種 <span className="text-red-600">*</span></label>
                <div className="relative">
                  <select {...register('business_type')} id="reg-business-type" className="form-input appearance-none pr-10" aria-required="true" {...describe('business_type', 'reg-business-type')}>
                    <option value="">選択してください</option>
                    {businessTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {chevron}
                </div>
                {fieldError('business_type', 'reg-business-type')}
              </div>
              {/* PC・iPad では対になる項目を横に並べる。縦一列のままだと画面が広いほど
                  間延びして、入力の終わりが見えない（実機の 1440px / 834px で確認）。 */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="reg-rep-name" className="form-label">代表者名 <span className="text-red-600">*</span></label>
                  <input {...register('representative_name')} id="reg-rep-name" autoComplete="name" className="form-input" placeholder="山田 太郎" aria-required="true" {...describe('representative_name', 'reg-rep-name')} />
                  {fieldError('representative_name', 'reg-rep-name')}
                  <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={contactSameAsRep} className={CHECKBOX}
                      onChange={event => { setContactSameAsRep(event.target.checked); setIsDirty(true); }} />
                    担当者も代表者と同じ
                  </label>
                </div>
                {!contactSameAsRep && (
                  <div>
                    <label htmlFor="reg-contact-name" className="form-label">担当者名 <span className="text-red-600">*</span></label>
                    <input {...register('contact_name')} id="reg-contact-name" autoComplete="section-contact name" className="form-input" placeholder="山田 花子" aria-required="true" {...describe('contact_name', 'reg-contact-name')} />
                    {fieldError('contact_name', 'reg-contact-name')}
                  </div>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="reg-email" className="form-label">メールアドレス <span className="text-red-600">*</span></label>
                  <input {...register('email')} id="reg-email" type="email" autoComplete="email" className="form-input" placeholder="example@email.com" aria-required="true" {...describe('email', 'reg-email')} />
                  {fieldError('email', 'reg-email')}
                </div>
                <div>
                  <label htmlFor="reg-phone" className="form-label">電話番号 <span className="text-red-600">*</span></label>
                  <input {...normalizedOnBlur('phone', normalizePhone)} id="reg-phone" type="tel" inputMode="tel" autoComplete="tel" className="form-input" placeholder="090-1234-5678" aria-required="true" maxLength={20} {...describe('phone', 'reg-phone')} />
                  {fieldError('phone', 'reg-phone')}
                </div>
              </div>
              {/* 任意項目は既定で畳む。必須と同じ見た目で並べると、スマホでは入力欄の壁にしか
                  見えず「まだこんなにあるのか」と離脱を招く。details は閉じていても中身が
                  DOM に在るため、react-hook-form の登録も検証も従来どおり効く。 */}
              <details className="group border border-(--ecru-line) bg-(--ecru-bg)/70 px-4 py-3">
                <summary className="cursor-pointer list-none text-xs font-medium text-(--ecru-muted) marker:content-none">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-base leading-none text-(--ecru-line) transition-transform group-open:rotate-45">+</span>
                    直通電話・Webサイトを追加する
                  </span>
                </summary>
                <div className="mt-4 space-y-4">
                  <div>
                    <label htmlFor="reg-contact-phone" className="form-label">担当者直通電話</label>
                    <input {...normalizedOnBlur('contact_phone', normalizePhone)} id="reg-contact-phone" type="tel" inputMode="tel" autoComplete="section-contact tel" maxLength={20} className="form-input" placeholder="090-1234-5678" {...describe('contact_phone', 'reg-contact-phone')} />
                    {fieldError('contact_phone', 'reg-contact-phone')}
                  </div>
                  <div>
                    <label htmlFor="reg-website" className="form-label">WebサイトURL</label>
                    <input {...normalizedOnBlur('website', normalizeWebsiteInput)} id="reg-website" type="url" autoComplete="url" className="form-input" placeholder="https://example.com" maxLength={2000} {...describe('website', 'reg-website')} />
                    {fieldError('website', 'reg-website')}
                  </div>
                </div>
              </details>
              <button type="button" onClick={nextStep} className={`btn-primary w-full ${STEP_BUTTON}`}>次へ</button>
            </div>
          )}

          {/* Step 2: 詳細情報 */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="reg-postal-code" className="form-label">郵便番号 <span className="text-(--ecru-muted) text-xs font-normal">7桁入力で住所を自動補完</span></label>
                <input {...normalizedOnBlur('postal_code', normalizePostalCodeInput)} id="reg-postal-code" autoComplete="postal-code" className="form-input" placeholder="5600001" maxLength={8} inputMode="numeric" {...describe('postal_code', 'reg-postal-code')} />
                {fieldError('postal_code', 'reg-postal-code')}
              </div>
              <div>
                <label htmlFor="reg-address" className="form-label">住所</label>
                <input {...addressRegistration} onChange={event => {
                  handleAddressChange();
                  void addressRegistration.onChange(event);
                }} id="reg-address" autoComplete="street-address" className="form-input" placeholder="大阪府堺市堺区…" maxLength={500} {...describe('address', 'reg-address')} />
                {fieldError('address', 'reg-address')}
              </div>
              <details className="group border border-(--ecru-line) bg-(--ecru-bg)/70 px-4 py-3">
                <summary className="cursor-pointer list-none text-xs font-medium text-(--ecru-muted) marker:content-none">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-base leading-none text-(--ecru-line) transition-transform group-open:rotate-45">+</span>
                    建物名・最寄り駅を追加する
                  </span>
                </summary>
                <div className="mt-4 space-y-4">
                  <div>
                    <label htmlFor="reg-building-name" className="form-label">建物名・部屋番号</label>
                    <input {...register('building_name')} id="reg-building-name" className="form-input" placeholder="○○ビル 3F" maxLength={200} {...describe('building_name', 'reg-building-name')} />
                    {fieldError('building_name', 'reg-building-name', SALON_FIELD_MESSAGES.building_name)}
                  </div>
                  <div>
                    <label htmlFor="reg-nearest-station" className="form-label">最寄り駅</label>
                    <input {...register('nearest_station')} id="reg-nearest-station" className="form-input" placeholder="堺東駅 徒歩5分" maxLength={200} {...describe('nearest_station', 'reg-nearest-station')} />
                    {fieldError('nearest_station', 'reg-nearest-station', SALON_FIELD_MESSAGES.nearest_station)}
                  </div>
                </div>
              </details>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="reg-business-hours" className="form-label">営業時間</label>
                  <input {...register('business_hours')} id="reg-business-hours" className="form-input" placeholder="10:00〜20:00" maxLength={200} {...describe('business_hours', 'reg-business-hours')} />
                  {fieldError('business_hours', 'reg-business-hours', SALON_FIELD_MESSAGES.business_hours)}
                </div>
                <div>
                  <label htmlFor="reg-regular-holiday" className="form-label">定休日</label>
                  <input {...register('regular_holiday')} id="reg-regular-holiday" className="form-input" placeholder="毎週月曜日" maxLength={200} {...describe('regular_holiday', 'reg-regular-holiday')} />
                  {fieldError('regular_holiday', 'reg-regular-holiday', SALON_FIELD_MESSAGES.regular_holiday)}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="reg-seat-count" className="form-label">席数・ベッド数</label>
                  <input {...register('seat_count', { valueAsNumber: true })} id="reg-seat-count" type="number" inputMode="numeric" min="0" max="9999" step="1" className="form-input" {...describe('seat_count', 'reg-seat-count')} />
                  {fieldError('seat_count', 'reg-seat-count', SALON_FIELD_MESSAGES.seat_count)}
                </div>
                <div>
                  <label htmlFor="reg-staff-count" className="form-label">スタッフ数</label>
                  <input {...register('staff_count', { valueAsNumber: true })} id="reg-staff-count" type="number" inputMode="numeric" min="0" max="9999" step="1" className="form-input" {...describe('staff_count', 'reg-staff-count')} />
                  {fieldError('staff_count', 'reg-staff-count', SALON_FIELD_MESSAGES.staff_count)}
                </div>
              </div>
              <div>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
                  <input {...register('has_parking')} type="checkbox" className={CHECKBOX} {...describe('has_parking', 'reg-has-parking')} />
                  駐車場あり
                </label>
                {fieldError('has_parking', 'reg-has-parking', SALON_FIELD_MESSAGES.has_parking)}
              </div>
              <fieldset className="min-w-0" tabIndex={-1} data-field="features" {...(errors.features ? { 'aria-describedby': 'reg-features-error' } : {})}>
                <legend className="form-label">こだわり・特徴 <span className="text-(--ecru-muted) text-xs font-normal">複数選択可</span></legend>
                <div className="flex flex-wrap gap-2">
                  {featureChoices.map(f => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => toggleFeature(f)}
                      aria-pressed={selectedFeatures.includes(f)}
                      className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm transition-colors ${
                        selectedFeatures.includes(f)
                          ? 'border-(--ecru-accent) bg-(--ecru-accent) text-white'
                          : 'border-(--ecru-line) bg-(--ecru-surface) text-(--ecru-text) hover:border-(--ecru-muted)'
                      }`}
                    >
                      {selectedFeatures.includes(f) && <span className="mr-1" aria-hidden="true">&#10003;</span>}
                      {f}
                    </button>
                  ))}
                </div>
                {fieldError('features', 'reg-features', SALON_FIELD_MESSAGES.features)}
              </fieldset>
              <div className="flex gap-4">
                <button type="button" onClick={() => goToStep(1)} className={`btn-outline flex-1 ${STEP_BUTTON}`}>戻る</button>
                <button type="button" onClick={nextStep} className={`btn-primary flex-1 ${STEP_BUTTON}`}>次へ</button>
              </div>
            </div>
          )}

          {/* Step 3: PR情報 */}
            <div className="space-y-4" hidden={step !== 3}>
              <div>
                <label htmlFor="reg-pr-text" className="form-label">PR文 <span className="text-(--ecru-muted) text-xs font-normal">1000文字以内</span></label>
                <textarea {...register('pr_text')} id="reg-pr-text" className="form-input min-h-[150px]" placeholder="お店の魅力を自由にご記入ください" maxLength={1000} {...describe('pr_text', 'reg-pr-text')} />
                <div className="flex justify-between gap-2 mt-1">
                  {fieldError('pr_text', 'reg-pr-text')}
                  <p className="text-sm text-(--ecru-muted) ml-auto">{prText.length}/1000</p>
                </div>
              </div>
              <fieldset className="min-w-0" {...(photoError ? { 'aria-describedby': 'reg-photos-error' } : {})}>
                <legend className="form-label">施設写真 <span className="text-(--ecru-muted) text-xs font-normal">{REGISTER_PHOTO_FIELD_NOTE}</span></legend>
                <MultiPhotoUpload key={restoreGeneration} slots={photoSlots} initialFiles={photoFiles} compress={compressImage} onChange={files => { setPhotoFiles(files); setIsDirty(true); }} />
                {photoError && <p id="reg-photos-error" className="form-error" role="alert">{photoError}</p>}
              </fieldset>
              <div>
                <label htmlFor="reg-desired-start-date" className="form-label">掲載希望時期</label>
                <div className="relative">
                  <select {...register('desired_start_date')} id="reg-desired-start-date" className="form-input appearance-none pr-10" {...describe('desired_start_date', 'reg-desired-start-date')}>
                    {startDateOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {chevron}
                </div>
                {fieldError('desired_start_date', 'reg-desired-start-date', SALON_FIELD_MESSAGES.desired_start_date)}
              </div>
              {restoredNeedsReview && <div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" id="reg-unsent-ack" checked={restoredUnsentAcknowledged}
                    disabled={submitting || submissionUnknown || submissionConfirmed || draftBusy}
                    aria-required="true" {...(checkError('unsent') ? { 'aria-invalid': true, 'aria-describedby': 'reg-unsent-error' } : {})}
                    onChange={event => setRestoredUnsentAcknowledged(event.target.checked)} className={CHECKBOX} />
                  <span>この下書きはまだ送信していません。送信済み・結果不明の場合は受付状況を確認します</span>
                </label>
                {checkError('unsent') && <p id="reg-unsent-error" className="form-error">{checkError('unsent')}</p>}
              </div>}
              <div>
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    id="reg-license"
                    checked={licenseWarranted}
                    onChange={(e) => setLicenseWarranted(e.target.checked)}
                    aria-required="true"
                    {...(checkError('license') ? { 'aria-invalid': true, 'aria-describedby': 'reg-license-error' } : {})}
                    className={CHECKBOX}
                  />
                  <span>
                    当施設の運営に法令上必要な許可・免許・届出（美容所開設届、施術所開設届、診療所開設届等）をすべて完了しており、施術は必要な資格を有する者が提供することを表明します（必須）
                  </span>
                </label>
                {checkError('license') && <p id="reg-license-error" className="form-error">{checkError('license')}</p>}
              </div>
              <div>
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    id="reg-terms"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    aria-required="true"
                    {...(checkError('terms') ? { 'aria-invalid': true, 'aria-describedby': 'reg-terms-error' } : {})}
                    className={CHECKBOX}
                  />
                  <span>
                    <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline">利用規約</a>
                    および
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline">プライバシーポリシー</a>
                    に同意する（必須）
                  </span>
                </label>
                {checkError('terms') && <p id="reg-terms-error" className="form-error">{checkError('terms')}</p>}
              </div>
              {consentAttempted && missingChecks.length > 0 && (
                <p role="alert" className="form-error font-medium">必須の同意にチェックしてください（残り{missingChecks.length}件）</p>
              )}
              <div className="flex gap-4">
                <button type="button" onClick={() => goToStep(2)} className={`btn-outline flex-1 ${STEP_BUTTON}`}>戻る</button>
                <button type="submit" disabled={submitting || submissionUnknown || submissionConfirmed || draftBusy || legacyStorageBlocked} className={`btn-primary flex-1 ${STEP_BUTTON}`}>
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
        // 受付と一般公開は別の手続き（/register の FAQ・受付メールと同じ事実を書く）。以前は
        // 「すぐに掲載を開始できます」と書いており、送信すれば公開されると誤解させていた。
        message="送信後、続けて店舗アカウントを作成すると、入力内容（営業時間・写真・特徴・PRなど）が管理画面に引き継がれます。一般公開は、管理画面で店舗名・所在地などを確認して公開の操作をした後に始まります（送信しただけでは公開されません）。"
        confirmLabel="送信する"
        cancelLabel="戻る"
        confirmDisabled={submitting || submissionUnknown || submissionConfirmed || draftBusy || (restoredNeedsReview && !restoredUnsentAcknowledged)}
        onConfirm={handleConfirmSubmit}
        onCancel={() => setShowConfirm(false)}
      />

      <ConfirmDialog
        open={leaveTarget !== null}
        title="入力途中のままページを移動しますか？"
        message={LEAVE_CONFIRM_MESSAGE}
        confirmLabel="移動する"
        cancelLabel="入力を続ける"
        variant="danger"
        onConfirm={() => {
          const target = leaveTarget;
          setLeaveTarget(null);
          // 確認済みの移動では beforeunload も鳴らさない。
          setIsDirty(false);
          if (target) router.push(target);
        }}
        onCancel={() => setLeaveTarget(null)}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
