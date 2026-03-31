'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import { salonStep1Schema, salonStep2Schema, salonStep3Schema, salonFullSchema, type SalonFormValues, formatPhone, businessTypes } from '@/lib/validations';
import { facilityFeatures } from '@/lib/constants';
import StepIndicator from '@/components/StepIndicator';
import MultiPhotoUpload, { type PhotoSlot } from '@/components/MultiPhotoUpload';
import Spinner from '@/components/Spinner';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';

const stepSchemas = [salonStep1Schema, salonStep2Schema, salonStep3Schema];
const stepLabels = ['基本情報', '詳細情報', 'PR情報'];

const photoSlots: PhotoSlot[] = [
  { label: '外観', required: true },
  { label: '内観 1' },
  { label: '内観 2' },
  { label: '内観 3' },
  { label: 'メニュー 1' },
  { label: 'メニュー 2' },
  { label: 'メニュー 3' },
];

const startDateOptions = [
  { value: '', label: '選択してください' },
  { value: 'immediately', label: 'すぐに掲載したい' },
  { value: 'within_1month', label: '1ヶ月以内' },
  { value: 'within_3months', label: '3ヶ月以内' },
  { value: 'undecided', label: '検討中' },
];

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [photoFiles, setPhotoFiles] = useState<(File | null)[]>(photoSlots.map(() => null));
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const { register, handleSubmit, trigger, setValue, watch, formState: { errors } } = useForm<SalonFormValues>({
    resolver: zodResolver(salonFullSchema),
    mode: 'onTouched',
    defaultValues: {
      facility_name: '', business_type: '', representative_name: '', contact_name: '',
      email: '', phone: '', contact_phone: '', website: '',
      postal_code: '', address: '', building_name: '', nearest_station: '',
      business_hours: '', regular_holiday: '', seat_count: null, staff_count: null,
      has_parking: false, features: [],
      pr_text: '', desired_start_date: '',
    },
  });

  const prText = watch('pr_text') || '';
  const postalCode = watch('postal_code') || '';
  const selectedFeatures = watch('features') || [];

  // Phone auto-hyphen
  const handlePhoneChange = (field: 'phone' | 'contact_phone') => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(field, formatPhone(e.target.value), { shouldValidate: true });
  };

  // Postal code auto-completion
  const fetchAddress = useCallback(async (code: string) => {
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 7) return;
    try {
      const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${digits}`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      if (data.results?.[0]) {
        const r = data.results[0];
        setValue('address', `${r.address1}${r.address2}${r.address3}`);
      }
    } catch { /* ignore */ }
  }, [setValue]);

  useEffect(() => {
    const digits = postalCode.replace(/\D/g, '');
    if (digits.length === 7) fetchAddress(postalCode);
  }, [postalCode, fetchAddress]);

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
  };

  const onSubmit = async (data: SalonFormValues) => {
    setSubmitting(true);
    try {
      // Upload photos
      const uuid = crypto.randomUUID();
      const photoUrls: string[] = [];
      const categories = ['exterior', 'interior_1', 'interior_2', 'interior_3', 'menu_1', 'menu_2', 'menu_3'];

      for (let i = 0; i < photoFiles.length; i++) {
        const file = photoFiles[i];
        if (!file) continue;
        const mimeToExt: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
        const ext = mimeToExt[file.type] || 'jpg';
        const path = `salons/${uuid}/${categories[i]}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('carelink-uploads').upload(path, file);
        if (uploadError) throw uploadError;
        const url = supabase.storage.from('carelink-uploads').getPublicUrl(path).data.publicUrl;
        photoUrls.push(url);
      }

      const { error } = await supabase.from('salons').insert({
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
        building_name: data.building_name || null,
        nearest_station: data.nearest_station || null,
        business_hours: data.business_hours || null,
        regular_holiday: data.regular_holiday || null,
        seat_count: data.seat_count && !isNaN(data.seat_count) ? data.seat_count : null,
        staff_count: data.staff_count && !isNaN(data.staff_count) ? data.staff_count : null,
        has_parking: data.has_parking || false,
        features: data.features || [],
        pr_text: data.pr_text || null,
        photo_url: photoUrls[0] || null,
        photo_urls: photoUrls,
        desired_start_date: data.desired_start_date || null,
      });
      if (error) throw error;

      // Slack notification (fire-and-forget)
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'salon',
          data: {
            facility_name: data.facility_name,
            business_type: data.business_type,
            representative_name: data.representative_name,
            phone: data.phone,
            email: data.email,
            address: data.address || undefined,
            desired_start_date: data.desired_start_date || undefined,
          },
        }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => {});

      setIsDirty(false);
      const params = new URLSearchParams();
      params.set('name', data.facility_name);
      params.set('type', data.business_type);
      if (data.address) params.set('area', data.address);
      router.push(`/register/complete?${params.toString()}`);
    } catch {
      setToast({ message: '送信に失敗しました。時間をおいて再度お試しください。', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="section-container">
      <h1 className="section-title">無料掲載登録</h1>
      <p className="text-center text-gray-500 text-sm mb-8">掲載料は一切かかりません。最短3分で登録できます。</p>
      <div className="max-w-2xl mx-auto">
        <StepIndicator currentStep={step} totalSteps={3} labels={stepLabels} />
        <form onSubmit={handleSubmit(() => setShowConfirm(true))} onChange={handleFieldChange} className="card">

          {/* Step 1: 基本情報 */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label htmlFor="reg-facility-name" className="form-label">施設名 <span className="text-red-500">*</span></label>
                <input {...register('facility_name')} id="reg-facility-name" className="form-input" placeholder="例：リラクゼーションサロン ABC" aria-required="true" />
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
              <div>
                <label htmlFor="reg-rep-name" className="form-label">代表者名 <span className="text-red-500">*</span></label>
                <input {...register('representative_name')} id="reg-rep-name" className="form-input" placeholder="例：山田 太郎" aria-required="true" />
                {errors.representative_name && <p className="form-error" role="alert">{errors.representative_name.message}</p>}
              </div>
              <div>
                <label htmlFor="reg-contact-name" className="form-label">担当者名 <span className="text-red-500">*</span></label>
                <input {...register('contact_name')} id="reg-contact-name" className="form-input" placeholder="例：山田 花子" aria-required="true" />
                {errors.contact_name && <p className="form-error" role="alert">{errors.contact_name.message}</p>}
              </div>
              <div>
                <label htmlFor="reg-email" className="form-label">メールアドレス <span className="text-red-500">*</span></label>
                <input {...register('email')} id="reg-email" type="email" autoComplete="email" className="form-input" placeholder="example@email.com" aria-required="true" />
                {errors.email && <p className="form-error" role="alert">{errors.email.message}</p>}
              </div>
              <div>
                <label htmlFor="reg-phone" className="form-label">電話番号 <span className="text-red-500">*</span></label>
                <input {...register('phone')} id="reg-phone" onChange={handlePhoneChange('phone')} autoComplete="tel" className="form-input" placeholder="090-1234-5678" aria-required="true" />
                {errors.phone && <p className="form-error" role="alert">{errors.phone.message}</p>}
              </div>
              <div>
                <label className="form-label">担当者直通電話 <span className="text-gray-400 text-xs font-normal">任意</span></label>
                <input {...register('contact_phone')} onChange={handlePhoneChange('contact_phone')} className="form-input" placeholder="090-1234-5678" />
                {errors.contact_phone && <p className="form-error" role="alert">{errors.contact_phone.message}</p>}
              </div>
              <div>
                <label className="form-label">WebサイトURL <span className="text-gray-400 text-xs font-normal">任意</span></label>
                <input {...register('website')} type="url" className="form-input" placeholder="https://example.com" />
                {errors.website && <p className="form-error" role="alert">{errors.website.message}</p>}
              </div>
              <button type="button" onClick={nextStep} className="btn-primary w-full !py-3">次へ</button>
            </div>
          )}

          {/* Step 2: 詳細情報 */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <label className="form-label">郵便番号 <span className="text-gray-400 text-xs font-normal">7桁入力で住所を自動補完</span></label>
                <input {...register('postal_code')} autoComplete="postal-code" className="form-input" placeholder="5600001" maxLength={7} inputMode="numeric" />
                {errors.postal_code && <p className="form-error" role="alert">{errors.postal_code.message}</p>}
              </div>
              <div>
                <label className="form-label">住所</label>
                <input {...register('address')} autoComplete="street-address" className="form-input" placeholder="例：大阪府堺市堺区..." />
              </div>
              <div>
                <label className="form-label">建物名・部屋番号 <span className="text-gray-400 text-xs font-normal">任意</span></label>
                <input {...register('building_name')} className="form-input" placeholder="例：○○ビル 3F" />
              </div>
              <div>
                <label className="form-label">最寄り駅 <span className="text-gray-400 text-xs font-normal">任意</span></label>
                <input {...register('nearest_station')} className="form-input" placeholder="例：堺東駅 徒歩5分" />
              </div>
              <div>
                <label className="form-label">営業時間</label>
                <input {...register('business_hours')} className="form-input" placeholder="例：10:00〜20:00" />
              </div>
              <div>
                <label className="form-label">定休日</label>
                <input {...register('regular_holiday')} className="form-input" placeholder="例：毎週月曜日" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">席数・ベッド数</label>
                  <input {...register('seat_count', { valueAsNumber: true })} type="number" min="0" className="form-input" />
                </div>
                <div>
                  <label className="form-label">スタッフ数</label>
                  <input {...register('staff_count', { valueAsNumber: true })} type="number" min="0" className="form-input" />
                </div>
              </div>
              <div>
                <label className="form-label flex items-center gap-2 cursor-pointer">
                  <input {...register('has_parking')} type="checkbox" className="w-4 h-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500" />
                  駐車場あり
                </label>
              </div>
              <div>
                <label className="form-label">こだわり・特徴 <span className="text-gray-400 text-xs font-normal">複数選択可</span></label>
                <div className="flex flex-wrap gap-2">
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
              </div>
              <div className="flex gap-4">
                <button type="button" onClick={() => setStep(1)} className="btn-outline flex-1">戻る</button>
                <button type="button" onClick={nextStep} className="btn-primary flex-1">次へ</button>
              </div>
            </div>
          )}

          {/* Step 3: PR情報 */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <label className="form-label">PR文 <span className="text-gray-400 text-xs font-normal">1000文字以内</span></label>
                <textarea {...register('pr_text')} className="form-input min-h-[150px]" placeholder="施設のアピールポイントをご記入ください&#10;例：当院は開業20年の実績があり、..." maxLength={1000} />
                <div className="flex justify-between mt-1">
                  {errors.pr_text && <p className="form-error" role="alert">{errors.pr_text.message}</p>}
                  <p className="text-sm text-gray-400 ml-auto">{prText.length}/1000</p>
                </div>
              </div>
              <div>
                <label className="form-label">施設写真 <span className="text-gray-400 text-xs font-normal">外観は必須・最大7枚</span></label>
                <MultiPhotoUpload slots={photoSlots} onChange={setPhotoFiles} />
              </div>
              <div>
                <label className="form-label">掲載希望時期</label>
                <select {...register('desired_start_date')} className="form-input">
                  {startDateOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
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
                <button type="submit" disabled={submitting || !agreed} className="btn-primary flex-1 !py-3">
                  {submitting ? <span className="flex items-center justify-center gap-2"><Spinner />送信中...</span> : '登録する'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>

      <ConfirmDialog
        open={showConfirm}
        title="登録内容を送信しますか？"
        message="送信後、担当者より3営業日以内にご連絡いたします。"
        confirmLabel="送信する"
        cancelLabel="戻る"
        onConfirm={() => { setShowConfirm(false); handleSubmit(onSubmit)(); }}
        onCancel={() => setShowConfirm(false)}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
