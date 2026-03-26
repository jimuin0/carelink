'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import { salonStep1Schema, salonStep2Schema, salonStep3Schema, salonFullSchema, type SalonFormValues, formatPhone, businessTypes } from '@/lib/validations';
import StepIndicator from '@/components/StepIndicator';
import PhotoUpload from '@/components/PhotoUpload';
import Spinner from '@/components/Spinner';
import Toast from '@/components/Toast';

const stepSchemas = [salonStep1Schema, salonStep2Schema, salonStep3Schema];
const stepLabels = ['基本情報', '詳細情報', 'PR情報'];

export default function RegisterPage() {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const { register, handleSubmit, trigger, setValue, watch, reset, formState: { errors } } = useForm<SalonFormValues>({
    resolver: zodResolver(salonFullSchema),
    mode: 'onTouched',
    defaultValues: { facility_name: '', business_type: '', representative_name: '', contact_name: '', email: '', phone: '', postal_code: '', address: '', business_hours: '', regular_holiday: '', seat_count: null, staff_count: null, pr_text: '', desired_start_date: '' },
  });

  const prText = watch('pr_text') || '';
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => { setValue('phone', formatPhone(e.target.value), { shouldValidate: true }); };

  const nextStep = async () => {
    const schema = stepSchemas[step - 1];
    const fields = Object.keys(schema.shape) as (keyof SalonFormValues)[];
    if (await trigger(fields)) setStep(step + 1);
  };

  const onSubmit = async (data: SalonFormValues) => {
    setSubmitting(true);
    try {
      let photo_url: string | null = null;
      if (photoFile) {
        const fileExt = photoFile.name.split('.').pop();
        const filePath = `salons/${crypto.randomUUID()}/photo.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('carelink-uploads').upload(filePath, photoFile);
        if (uploadError) throw uploadError;
        photo_url = supabase.storage.from('carelink-uploads').getPublicUrl(filePath).data.publicUrl;
      }
      const { error } = await supabase.from('salons').insert({
        facility_name: data.facility_name, business_type: data.business_type, representative_name: data.representative_name,
        contact_name: data.contact_name, email: data.email, phone: data.phone,
        postal_code: data.postal_code || null, address: data.address || null, business_hours: data.business_hours || null,
        regular_holiday: data.regular_holiday || null,
        seat_count: data.seat_count && !isNaN(data.seat_count) ? data.seat_count : null,
        staff_count: data.staff_count && !isNaN(data.staff_count) ? data.staff_count : null,
        pr_text: data.pr_text || null, photo_url, desired_start_date: data.desired_start_date || null,
      });
      if (error) throw error;
      fetch('/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'salon', data: { facility_name: data.facility_name, business_type: data.business_type, representative_name: data.representative_name, phone: data.phone, email: data.email } }) }).catch(() => {});
      setToast({ message: '登録が完了しました。担当者より2営業日以内にご連絡いたします。', type: 'success' });
      reset(); setStep(1); setPhotoFile(null);
    } catch { setToast({ message: '送信に失敗しました。時間をおいて再度お試しください。', type: 'error' }); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="section-container">
      <h1 className="section-title">無料掲載登録</h1>
      <div className="max-w-2xl mx-auto">
        <StepIndicator currentStep={step} totalSteps={3} labels={stepLabels} />
        <form onSubmit={handleSubmit(onSubmit)} className="card">
          {step === 1 && (
            <div className="space-y-5">
              <div><label className="form-label">施設名 <span className="text-red-500">*</span></label><input {...register('facility_name')} className="form-input" placeholder="例：リラクゼーションサロン ABC" />{errors.facility_name && <p className="form-error">{errors.facility_name.message}</p>}</div>
              <div><label className="form-label">業種 <span className="text-red-500">*</span></label><select {...register('business_type')} className="form-input"><option value="">選択してください</option>{businessTypes.map(t => <option key={t} value={t}>{t}</option>)}</select>{errors.business_type && <p className="form-error">{errors.business_type.message}</p>}</div>
              <div><label className="form-label">代表者名 <span className="text-red-500">*</span></label><input {...register('representative_name')} className="form-input" placeholder="例：山田 太郎" />{errors.representative_name && <p className="form-error">{errors.representative_name.message}</p>}</div>
              <div><label className="form-label">担当者名 <span className="text-red-500">*</span></label><input {...register('contact_name')} className="form-input" placeholder="例：山田 花子" />{errors.contact_name && <p className="form-error">{errors.contact_name.message}</p>}</div>
              <div><label className="form-label">メールアドレス <span className="text-red-500">*</span></label><input {...register('email')} type="email" className="form-input" placeholder="example@email.com" />{errors.email && <p className="form-error">{errors.email.message}</p>}</div>
              <div><label className="form-label">電話番号 <span className="text-red-500">*</span></label><input {...register('phone')} onChange={handlePhoneChange} className="form-input" placeholder="090-1234-5678" />{errors.phone && <p className="form-error">{errors.phone.message}</p>}</div>
              <button type="button" onClick={nextStep} className="btn-primary w-full">次へ</button>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-5">
              <div><label className="form-label">郵便番号</label><input {...register('postal_code')} className="form-input" placeholder="1234567（ハイフンなし）" maxLength={7} />{errors.postal_code && <p className="form-error">{errors.postal_code.message}</p>}</div>
              <div><label className="form-label">住所</label><input {...register('address')} className="form-input" placeholder="例：東京都渋谷区..." /></div>
              <div><label className="form-label">営業時間</label><input {...register('business_hours')} className="form-input" placeholder="例：10:00〜20:00" /></div>
              <div><label className="form-label">定休日</label><input {...register('regular_holiday')} className="form-input" placeholder="例：毎週月曜日" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="form-label">席数・ベッド数</label><input {...register('seat_count', { valueAsNumber: true })} type="number" min="0" className="form-input" /></div>
                <div><label className="form-label">スタッフ数</label><input {...register('staff_count', { valueAsNumber: true })} type="number" min="0" className="form-input" /></div>
              </div>
              <div className="flex gap-4"><button type="button" onClick={() => setStep(1)} className="btn-outline flex-1">戻る</button><button type="button" onClick={nextStep} className="btn-primary flex-1">次へ</button></div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-5">
              <div><label className="form-label">PR文</label><textarea {...register('pr_text')} className="form-input min-h-[120px]" placeholder="施設のアピールポイントをご記入ください" maxLength={500} /><div className="flex justify-between mt-1">{errors.pr_text && <p className="form-error">{errors.pr_text.message}</p>}<p className="text-sm text-gray-400 ml-auto">{prText.length}/500</p></div></div>
              <div><label className="form-label">施設写真</label><PhotoUpload onChange={setPhotoFile} /></div>
              <div><label className="form-label">希望掲載開始日</label><input {...register('desired_start_date')} type="date" className="form-input" /></div>
              <div className="flex gap-4"><button type="button" onClick={() => setStep(2)} className="btn-outline flex-1">戻る</button><button type="submit" disabled={submitting} className="btn-primary flex-1">{submitting ? <span className="flex items-center justify-center gap-2"><Spinner />送信中...</span> : '登録する'}</button></div>
            </div>
          )}
        </form>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
