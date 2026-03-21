'use client';

import { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import {
  salonStep1Schema,
  salonStep2Schema,
  salonStep3Schema,
  salonFullSchema,
  type SalonFormValues,
  formatPhone,
  businessTypes,
} from '@/lib/validations';
import StepIndicator from '@/components/StepIndicator';
import PhotoUpload from '@/components/PhotoUpload';
import Spinner from '@/components/Spinner';
import Toast from '@/components/Toast';
import FAQ from '@/components/FAQ';
import ConfirmDialog from '@/components/ConfirmDialog';

const stepSchemas = [salonStep1Schema, salonStep2Schema, salonStep3Schema];
const stepLabels = ['基本情報', '詳細情報', 'PR情報'];

const faqItems = [
  { question: '掲載は本当に無料ですか？', answer: 'はい、完全無料です。' },
  {
    question: '掲載開始までどのくらいかかりますか？',
    answer: '登録後、2営業日以内に担当者よりご連絡いたします。',
  },
  {
    question: '途中で掲載をやめることはできますか？',
    answer: 'いつでも退会・掲載停止が可能です。',
  },
];

export default function SalonPage() {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const {
    register,
    handleSubmit,
    trigger,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<SalonFormValues>({
    resolver: zodResolver(salonFullSchema),
    mode: 'onTouched',
    defaultValues: {
      facility_name: '',
      business_type: '',
      representative_name: '',
      contact_name: '',
      email: '',
      phone: '',
      postal_code: '',
      address: '',
      business_hours: '',
      regular_holiday: '',
      seat_count: null,
      staff_count: null,
      pr_text: '',
      desired_start_date: '',
    },
  });

  const prText = watch('pr_text') || '';

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    setValue('phone', formatted, { shouldValidate: true });
  };

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const nextStep = async () => {
    const schema = stepSchemas[step - 1];
    const fields = Object.keys(schema.shape) as (keyof SalonFormValues)[];
    const valid = await trigger(fields);
    if (valid) setStep(step + 1);
  };

  const prevStep = () => setStep(step - 1);

  const handleConfirmSubmit = () => {
    setShowConfirm(false);
    handleSubmit(onSubmit)();
  };


  const onSubmit = async (data: SalonFormValues) => {
    setSubmitting(true);
    try {
      let photo_url: string | null = null;

      if (photoFile) {
        const fileExt = photoFile.name.split('.').pop();
        const uuid = crypto.randomUUID();
        const filePath = `salons/${uuid}/photo.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('carelink-uploads')
          .upload(filePath, photoFile);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('carelink-uploads')
          .getPublicUrl(filePath);

        photo_url = urlData.publicUrl;
      }

      const insertData = {
        facility_name: data.facility_name,
        business_type: data.business_type,
        representative_name: data.representative_name,
        contact_name: data.contact_name,
        email: data.email,
        phone: data.phone,
        postal_code: data.postal_code || null,
        address: data.address || null,
        business_hours: data.business_hours || null,
        regular_holiday: data.regular_holiday || null,
        seat_count: data.seat_count && !isNaN(data.seat_count) ? data.seat_count : null,
        staff_count: data.staff_count && !isNaN(data.staff_count) ? data.staff_count : null,
        pr_text: data.pr_text || null,
        photo_url,
        desired_start_date: data.desired_start_date || null,
      };

      const { error } = await supabase.from('salons').insert(insertData);
      if (error) throw error;

      setToast({
        message: '登録が完了しました。担当者より2営業日以内にご連絡いたします。',
        type: 'success',
      });
      reset();
      setStep(1);
      setPhotoFile(null);
    } catch {
      setToast({
        message: '送信に失敗しました。時間をおいて再度お試しください。',
        type: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-sky-50 to-white">
        <div className="section-container text-center">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black mb-6 leading-tight">
            あなたの施設を、
            <br />
            <span style={{ color: 'var(--primary)' }}>必要な人に届ける</span>
          </h1>
          <p className="text-gray-600 text-lg sm:text-xl mb-8">
            掲載無料・登録3分・すぐに集客開始
          </p>
          <button onClick={scrollToForm} className="btn-primary text-lg">
            無料で掲載登録する
          </button>
        </div>
      </section>

      {/* Merits */}
      <section className="bg-white">
        <div className="section-container">
          <h2 className="section-title">CareLink が選ばれる理由</h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              {
                icon: '💰',
                title: '掲載・登録が完全無料',
                desc: '初期費用・月額費用は一切かかりません。リスクゼロで集客を始められます。',
              },
              {
                icon: '🎯',
                title: '医療・福祉・美容に特化',
                desc: '業界特化だからこそ、あなたの施設を必要としている人に確実に届きます。',
              },
              {
                icon: '🤖',
                title: 'AI自動マッチング',
                desc: 'AIがお客様と施設を自動でマッチング。効率的に集客を実現します。',
              },
            ].map((item) => (
              <div key={item.title} className="card text-center">
                <div className="text-4xl mb-4">{item.icon}</div>
                <h3 className="text-xl font-bold mb-3">{item.title}</h3>
                <p className="text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="bg-gray-50">
        <div className="section-container">
          <h2 className="section-title">CareLink でできること</h2>
          <div className="grid sm:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              { title: '店舗プロフィール掲載', desc: 'メニュー・料金・写真を掲載して集客', available: true },
              { title: '予約受付', desc: 'オンライン予約機能で機会を逃さない', available: false },
              { title: '口コミ・レビュー管理', desc: '口コミで信頼度アップ', available: false },
            ].map((item) => (
              <div key={item.title} className="card text-center relative">
                {!item.available && (
                  <span className="absolute top-4 right-4 text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded-full">
                    Coming Soon
                  </span>
                )}
                <h3 className="text-lg font-bold mb-2">{item.title}</h3>
                <p className="text-gray-600 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Form */}
      <section className="bg-white" ref={formRef}>
        <div className="section-container">
          <h2 className="section-title">無料掲載登録</h2>
          <div className="max-w-2xl mx-auto">
            <StepIndicator currentStep={step} totalSteps={3} labels={stepLabels} />

            <form onSubmit={handleSubmit(() => setShowConfirm(true))} className="card">
              {/* Step 1 */}
              {step === 1 && (
                <div className="space-y-5">
                  <div>
                    <label className="form-label">施設名 <span className="text-red-500">*</span></label>
                    <input {...register('facility_name')} className="form-input" placeholder="例：リラクゼーションサロン ABC" />
                    {errors.facility_name && <p className="form-error">{errors.facility_name.message}</p>}
                  </div>
                  <div>
                    <label className="form-label">業種 <span className="text-red-500">*</span></label>
                    <select {...register('business_type')} className="form-input">
                      <option value="">選択してください</option>
                      {businessTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {errors.business_type && <p className="form-error">{errors.business_type.message}</p>}
                  </div>
                  <div>
                    <label className="form-label">代表者名 <span className="text-red-500">*</span></label>
                    <input {...register('representative_name')} className="form-input" placeholder="例：山田 太郎" />
                    {errors.representative_name && <p className="form-error">{errors.representative_name.message}</p>}
                  </div>
                  <div>
                    <label className="form-label">担当者名 <span className="text-red-500">*</span></label>
                    <input {...register('contact_name')} className="form-input" placeholder="例：山田 花子" />
                    {errors.contact_name && <p className="form-error">{errors.contact_name.message}</p>}
                  </div>
                  <div>
                    <label className="form-label">メールアドレス <span className="text-red-500">*</span></label>
                    <input {...register('email')} type="email" className="form-input" placeholder="example@email.com" />
                    {errors.email && <p className="form-error">{errors.email.message}</p>}
                  </div>
                  <div>
                    <label className="form-label">電話番号 <span className="text-red-500">*</span></label>
                    <input
                      {...register('phone')}
                      onChange={handlePhoneChange}
                      className="form-input"
                      placeholder="090-1234-5678"
                    />
                    {errors.phone && <p className="form-error">{errors.phone.message}</p>}
                  </div>
                  <button type="button" onClick={nextStep} className="btn-primary w-full">
                    次へ
                  </button>
                </div>
              )}

              {/* Step 2 */}
              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <label className="form-label">郵便番号</label>
                    <input {...register('postal_code')} className="form-input" placeholder="1234567（ハイフンなし）" maxLength={7} />
                    {errors.postal_code && <p className="form-error">{errors.postal_code.message}</p>}
                  </div>
                  <div>
                    <label className="form-label">住所</label>
                    <input {...register('address')} className="form-input" placeholder="例：東京都渋谷区..." />
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
                  <div className="flex gap-4">
                    <button type="button" onClick={prevStep} className="btn-outline flex-1">
                      戻る
                    </button>
                    <button type="button" onClick={nextStep} className="btn-primary flex-1">
                      次へ
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3 */}
              {step === 3 && (
                <div className="space-y-5">
                  <div>
                    <label className="form-label">PR文</label>
                    <textarea
                      {...register('pr_text')}
                      className="form-input min-h-[120px]"
                      placeholder="施設のアピールポイントをご記入ください"
                      maxLength={500}
                    />
                    <div className="flex justify-between mt-1">
                      {errors.pr_text && <p className="form-error">{errors.pr_text.message}</p>}
                      <p className="text-sm text-gray-400 ml-auto">{prText.length}/500</p>
                    </div>
                  </div>
                  <div>
                    <label className="form-label">施設写真</label>
                    <PhotoUpload onChange={setPhotoFile} />
                  </div>
                  <div>
                    <label className="form-label">希望掲載開始日</label>
                    <input {...register('desired_start_date')} type="date" className="form-input" />
                  </div>
                  <div className="flex gap-4">
                    <button type="button" onClick={prevStep} className="btn-outline flex-1">
                      戻る
                    </button>
                    <button type="submit" disabled={submitting} className="btn-primary flex-1">
                      {submitting ? (
                        <span className="flex items-center justify-center gap-2">
                          <Spinner />
                          送信中...
                        </span>
                      ) : (
                        '登録する'
                      )}
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-gray-50">
        <div className="section-container">
          <h2 className="section-title">よくある質問</h2>
          <FAQ items={faqItems} />
        </div>
      </section>

      <ConfirmDialog
        open={showConfirm}
        title="登録内容の確認"
        message="入力内容を送信します。よろしいですか？"
        confirmLabel="登録する"
        onConfirm={handleConfirmSubmit}
        onCancel={() => setShowConfirm(false)}
      />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
