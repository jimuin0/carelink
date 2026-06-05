'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Breadcrumb from '@/components/Breadcrumb';
import StepIndicator from '@/components/StepIndicator';
import Toast from '@/components/Toast';
import Spinner from '@/components/Spinner';
import { formatPhone } from '@/lib/validations';

const phoneRegex = /^[\d-]+$/;

const step1Schema = z.object({
  facility_name: z.string().min(1, '施設名を入力してください').max(100),
  business_type: z.string().min(1, '業種を選択してください'),
  representative_name: z.string().min(1, '代表者名を入力してください').max(50),
  contact_name: z.string().min(1, '担当者名を入力してください').max(50),
  email: z.string().email('正しいメールアドレスを入力してください').max(254),
  phone: z.string().min(1, '電話番号を入力してください').max(20).regex(phoneRegex, '正しい電話番号を入力してください'),
});

const step2Schema = z.object({
  postal_code: z.string().regex(/^(\d{7})?$/, '7桁の数字で入力してください').or(z.literal('')).optional(),
  address: z.string().max(200).optional(),
  website: z.string().max(500).optional(),
  description: z.string().max(1000, '1000文字以内で入力してください').optional(),
});

const fullSchema = step1Schema.merge(step2Schema);
type FormValues = z.infer<typeof fullSchema>;

const businessTypes = ['鍼灸院・整骨院', '美容室・理容室', 'エステサロン', 'まつエクサロン', 'ネイルサロン', '訪問看護', 'デイサービス', '介護施設', 'クリニック', 'その他'];

export default function RecruitPage() {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { register, handleSubmit, trigger, formState: { errors }, setValue, watch } = useForm<FormValues>({
    resolver: zodResolver(fullSchema),
    mode: 'onBlur',
  });

  const phoneValue = watch('phone');

  async function nextStep() {
    const schemas = [
      ['facility_name', 'business_type', 'representative_name', 'contact_name', 'email', 'phone'],
      ['postal_code', 'address', 'website', 'description'],
    ];
    const valid = await trigger(schemas[step - 1] as (keyof FormValues)[]);
    if (valid) setStep(step + 1);
  }

  async function onSubmit(data: FormValues) {
    setSubmitting(true);
    try {
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
        }),
      });
      if (!res.ok) throw new Error('registration failed');

      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'facility',
          data: {
            facility_name: data.facility_name,
            contact_name: data.contact_name,
            email: data.email,
            phone: data.phone,
            business_type: data.business_type,
          },
        }),
      }).catch(() => {});

      setDone(true);
    } catch (e: unknown) {
      setToast({ message: `登録に失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`, type: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="section-container text-center py-20">
        <h1 className="text-2xl font-bold mb-4">掲載申し込みが完了しました</h1>
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

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="card mt-8">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="form-label">施設名 *</label>
                <input {...register('facility_name')} maxLength={100} className="form-input w-full" placeholder="例: ○○鍼灸院" aria-required="true" />
                {errors.facility_name && <p className="form-error" role="alert">{errors.facility_name.message}</p>}
              </div>
              <div>
                <label className="form-label">業種 *</label>
                <select {...register('business_type')} className="form-input w-full" aria-required="true">
                  <option value="">選択してください</option>
                  {businessTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {errors.business_type && <p className="form-error" role="alert">{errors.business_type.message}</p>}
              </div>
              <div>
                <label className="form-label">代表者名 *</label>
                <input {...register('representative_name')} maxLength={50} className="form-input w-full" aria-required="true" />
                {errors.representative_name && <p className="form-error" role="alert">{errors.representative_name.message}</p>}
              </div>
              <div>
                <label className="form-label">担当者名 *</label>
                <input {...register('contact_name')} maxLength={50} className="form-input w-full" aria-required="true" />
                {errors.contact_name && <p className="form-error" role="alert">{errors.contact_name.message}</p>}
              </div>
              <div>
                <label className="form-label">メールアドレス *</label>
                <input type="email" {...register('email')} maxLength={254} className="form-input w-full" aria-required="true" />
                {errors.email && <p className="form-error" role="alert">{errors.email.message}</p>}
              </div>
              <div>
                <label className="form-label">電話番号 *</label>
                <input {...register('phone')} maxLength={20} className="form-input w-full" value={phoneValue ? formatPhone(phoneValue) : ''} onChange={(e) => setValue('phone', e.target.value.replace(/[^\d-]/g, ''))} />
                {errors.phone && <p className="form-error" role="alert">{errors.phone.message}</p>}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="form-label">郵便番号</label>
                <input {...register('postal_code')} className="form-input w-full" placeholder="1234567（ハイフンなし）" maxLength={7} />
                {errors.postal_code && <p className="form-error" role="alert">{errors.postal_code.message}</p>}
              </div>
              <div>
                <label className="form-label">住所</label>
                <input {...register('address')} maxLength={200} className="form-input w-full" placeholder="例: 大阪府豊中市〇〇町1-2-3" />
              </div>
              <div>
                <label className="form-label">ウェブサイト</label>
                <input {...register('website')} maxLength={500} className="form-input w-full" placeholder="https://..." />
              </div>
              <div>
                <label className="form-label">施設紹介</label>
                <textarea {...register('description')} className="form-input w-full" rows={4} maxLength={1000} placeholder="施設の特徴やPRをご記入ください" />
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
        </form>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
