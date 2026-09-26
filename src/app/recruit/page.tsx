'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useForm, useWatch, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Breadcrumb from '@/components/Breadcrumb';
import StepIndicator from '@/components/StepIndicator';
import Toast from '@/components/Toast';
import Spinner from '@/components/Spinner';
import { formatPhone, salonStep1Schema, salonStep2Schema, salonStep3Schema, businessTypes } from '@/lib/validations';
import { normalizePhone } from '@/lib/phone';
import { getRecaptchaToken } from '@/lib/recaptcha-client';
import { readSalonRegistrationResult, SALON_SUBMISSION_UNKNOWN } from '@/lib/salon-registration-delivery';

// 【2026年7月16日 恒久根治】従来はこのページ固有の緩い正規表現(/^[\d-]+$/、先頭0任意・
// 全角未対応)を独自定義しており、サーバー側 /api/salons が使う共通ヘルパー phoneField()
// （予約/問い合わせ/会員登録の全箇所で使用・先頭0必須の phoneRegex + 全角→半角正規化）より
// 検証が緩かった。クライアントを通過してもサーバーで400になる不一致を解消するため、
// 正規表現を複製せず共通ヘルパーを直接importして統一する（将来のドリフト防止）。
const step1Schema = salonStep1Schema.pick({ facility_name: true, business_type: true, representative_name: true, contact_name: true, email: true, phone: true });

const step2Schema = z.object({
  postal_code: salonStep2Schema.shape.postal_code,
  address: salonStep2Schema.shape.address,
  website: salonStep1Schema.shape.website,
  description: salonStep3Schema.shape.pr_text,
});

const fullSchema = step1Schema.merge(step2Schema);
type FormValues = z.infer<typeof fullSchema>;

export default function RecruitPage() {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [receipt, setReceipt] = useState('');
  const [unknown, setUnknown] = useState(false);
  const unknownRef = useRef(false);
  const submitLock = useRef(false);
  const [pendingFocus, setPendingFocus] = useState<{ field: keyof FormValues } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { register, handleSubmit, trigger, formState: { errors }, setValue, setError, getFieldState, control } = useForm<FormValues>({
    resolver: zodResolver(fullSchema),
    mode: 'onBlur',
  });

  const phoneValue = useWatch({ control, name: 'phone' });

  useEffect(() => {
    if (pendingFocus) {
      document.querySelector<HTMLElement>(`[name="${pendingFocus.field}"]`)?.focus();
    }
  }, [pendingFocus]);
  function revealErrors(invalid: FieldErrors<FormValues>) {
    for (const [index, schema] of [step1Schema, step2Schema].entries()) {
      const field = (Object.keys(schema.shape) as (keyof FormValues)[]).find(key => invalid[key]);
      if (field) { setStep(index + 1); setPendingFocus({ field }); return; }
    }
  }

  async function nextStep() {
    const schemas = [
      ['facility_name', 'business_type', 'representative_name', 'contact_name', 'email', 'phone'],
      ['postal_code', 'address', 'website', 'description'],
    ];
    const valid = await trigger(schemas[step - 1] as (keyof FormValues)[]);
    if (valid) setStep(step + 1);
    else {
      const invalid: FieldErrors<FormValues> = {};
      for (const field of schemas[step - 1] as (keyof FormValues)[]) {
        const error = getFieldState(field).error;
        if (error) invalid[field] = error;
      }
      revealErrors(invalid);
    }
  }

  async function onSubmit(data: FormValues) {
    if (unknownRef.current) return;
    setSubmitting(true);
    let requestStarted = false;
    let rejected = false;
    try {
      const recaptchaToken = await getRecaptchaToken('salons');
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
          postal_code: data.postal_code || null,
          address: data.address || null,
          website: data.website || null,
          pr_text: data.description || null,
          // 【2026年7月16日 恒久根治・/api/notify 廃止対応】従来はここで送信成功後に
          // 認証なしの公開POST /api/notify を別途叩いて Slack 通知していたが、外部から
          // 偽アラートを送れる構造的脆弱性だったため廃止。/api/salons が保存成功後に
          // サーバー側から直接 Slack 通知を送るため、どちらのテンプレートを使うかを
          // このフィールドで伝える（DBには保存されない）。
          source: 'recruit',
          ...(recaptchaToken ? { recaptcha_token: recaptchaToken } : {}),
        }),
      });
      const result = await readSalonRegistrationResult(res);
      if (result.kind === 'rejected') {
        rejected = true;
        const invalid: FieldErrors<FormValues> = {};
        for (const field of Object.keys(fullSchema.shape) as (keyof FormValues)[]) {
          const message = result.fieldErrors?.[field === 'description' ? 'pr_text' : field];
          if (message) { const error = { type: 'server', message }; setError(field, error); invalid[field] = error; }
        }
        revealErrors(invalid);
        throw new Error(result.message);
      }
      if (result.kind === 'unknown') throw new Error(SALON_SUBMISSION_UNKNOWN);
      setReceipt(result.id);
      setDone(true);
    } catch (e: unknown) {
      // e.message は上の throw で日本語の理由（サーバーJSONのerror or 既定文言）が
      // 入っているため、そのまま表示する（"登録に失敗しました: " の二重prefixをしない）。
      if (requestStarted && !rejected) { unknownRef.current = true; setUnknown(true); }
      else setToast({ message: e instanceof Error ? e.message : '登録に失敗しました。時間をおいて再度お試しください。', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="section-container text-center py-20">
        <h1 className="text-2xl font-bold mb-4">掲載申し込みが完了しました</h1>
        <p className="mb-4 break-all">受付番号：{receipt}</p>
        <p className="mb-4">この表示は申込の受付完了です。一般公開一覧への掲載完了ではありません。</p>
        <p className="text-gray-500 mb-8">担当者より2営業日以内にご連絡いたします。</p>
        <Link href="/" className="btn-primary px-8 py-3">トップページに戻る</Link>
      </div>
    );
  }

  return (
    <div className="section-container">
      <Breadcrumb items={[{ label: 'ホーム', href: '/' }, { label: '掲載申し込み（施設様向け）' }]} />
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2 text-center">施設を無料で掲載</h1>
        <p className="text-gray-500 text-center mb-8">掲載料は一切かかりません。まずはお気軽にご登録ください。</p>

        <StepIndicator currentStep={step} totalSteps={2} labels={['施設情報', '施設詳細']} />
        {unknown && <div role="alert" className="mt-4 rounded border border-amber-300 p-4"><p>{SALON_SUBMISSION_UNKNOWN}</p><Link href="/contact" className="underline">受付状況を問い合わせる</Link></div>}
        <form onSubmit={(event) => {
          event.preventDefault();
          if (submitLock.current || unknownRef.current) return;
          submitLock.current = true;
          void handleSubmit(onSubmit, revealErrors)(event).finally(() => { submitLock.current = false; });
        }} noValidate className="card mt-8">
          <fieldset disabled={submitting || unknown}>
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="recruit-facility_name" className="form-label">施設名 *</label>
                <input {...register('facility_name')} id="recruit-facility_name" maxLength={200} className="form-input w-full" placeholder="例: ○○鍼灸院" aria-required="true" />
                {errors.facility_name && <p className="form-error" role="alert">{errors.facility_name.message}</p>}
              </div>
              <div>
                <label htmlFor="recruit-business_type" className="form-label">業種 *</label>
                <select {...register('business_type')} id="recruit-business_type" className="form-input w-full" aria-required="true">
                  <option value="">選択してください</option>
                  {businessTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {errors.business_type && <p className="form-error" role="alert">{errors.business_type.message}</p>}
                <p className="text-sm text-gray-500">該当する業種がない場合は「その他」を選び、施設紹介に具体的な業種をご記入ください。</p>
              </div>
              <div>
                <label htmlFor="recruit-representative_name" className="form-label">代表者名 *</label>
                <input {...register('representative_name')} id="recruit-representative_name" maxLength={100} className="form-input w-full" aria-required="true" />
                {errors.representative_name && <p className="form-error" role="alert">{errors.representative_name.message}</p>}
              </div>
              <div>
                <label htmlFor="recruit-contact_name" className="form-label">担当者名 *</label>
                <input {...register('contact_name')} id="recruit-contact_name" maxLength={100} className="form-input w-full" aria-required="true" />
                {errors.contact_name && <p className="form-error" role="alert">{errors.contact_name.message}</p>}
              </div>
              <div>
                <label htmlFor="recruit-email" className="form-label">メールアドレス *</label>
                <input type="email" {...register('email')} id="recruit-email" maxLength={254} className="form-input w-full" aria-required="true" />
                {errors.email && <p className="form-error" role="alert">{errors.email.message}</p>}
              </div>
              <div>
                <label htmlFor="recruit-phone" className="form-label">電話番号 *</label>
                {/* 【2026年7月16日 恒久根治】従来は replace(/[^\d-]/g, '') を先にかけており、
                    全角数字「０９０」等が即除去され、サーバー側 normalizePhone（NFKC 全角→半角
                    正規化）が実UIから到達不能だった。normalizePhone を先に通してから絞ることで、
                    全角入力もサーバーと同じ規則で半角化してから表示・保持する。 */}
                <input {...register('phone')} id="recruit-phone" maxLength={20} className="form-input w-full" value={phoneValue ? formatPhone(phoneValue) : ''} onChange={(e) => setValue('phone', normalizePhone(e.target.value).replace(/[^\d-]/g, ''))} />
                {errors.phone && <p className="form-error" role="alert">{errors.phone.message}</p>}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="recruit-postal_code" className="form-label">郵便番号</label>
                <input {...register('postal_code')} id="recruit-postal_code" className="form-input w-full" placeholder="1234567（ハイフン可）" maxLength={8} />
                {errors.postal_code && <p className="form-error" role="alert">{errors.postal_code.message}</p>}
              </div>
              <div>
                <label htmlFor="recruit-address" className="form-label">住所</label>
                <input {...register('address')} id="recruit-address" maxLength={500} className="form-input w-full" placeholder="例: 大阪府豊中市〇〇町1-2-3" />
                {errors.address && <p className="form-error" role="alert">{errors.address.message}</p>}
              </div>
              <div>
                <label htmlFor="recruit-website" className="form-label">ウェブサイト</label>
                <input {...register('website')} id="recruit-website" maxLength={2000} className="form-input w-full" placeholder="https://..." />
                {errors.website && <p className="form-error" role="alert">{errors.website.message}</p>}
              </div>
              <div>
                <label htmlFor="recruit-description" className="form-label">施設紹介</label>
                <textarea {...register('description')} id="recruit-description" className="form-input w-full" rows={4} maxLength={1000} placeholder="施設の特徴やPRをご記入ください" />
                {errors.description && <p className="form-error" role="alert">{errors.description.message}</p>}
              </div>
            </div>
          )}

          <div className="flex justify-between mt-8">
            {step > 1 && (
              <button type="button" onClick={() => setStep(step - 1)} className="btn-outline px-6 py-2">戻る</button>
            )}
            <div className="ml-auto">
              {step < 2 ? (
                <button type="button" onClick={nextStep} className="btn-primary px-8 py-2">次へ</button>
              ) : (
                <button type="submit" disabled={submitting} className="btn-primary px-8 py-2 disabled:opacity-50">
                  {submitting ? <Spinner /> : '掲載を申し込む'}
                </button>
              )}
            </div>
          </div>
          </fieldset>
        </form>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
