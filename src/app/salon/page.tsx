'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
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
  {
    question: '掲載は本当に無料ですか？',
    answer: 'はい、完全無料でご利用いただけます。初期費用・月額費用・成果報酬など一切かかりません。費用を気にせず、まずはお気軽にご登録ください。',
  },
  {
    question: '掲載開始までどのくらいかかりますか？',
    answer: 'フォーム送信後、2営業日以内に担当者よりご連絡いたします。内容確認後、すぐに掲載を開始できます。お急ぎの場合はお問い合わせフォームよりご相談ください。',
  },
  {
    question: '途中で掲載をやめることはできますか？',
    answer: 'はい、いつでも掲載停止・退会が可能です。違約金等は一切ございません。掲載停止後はデータを速やかに削除いたします。',
  },
  {
    question: 'どのような業種が掲載できますか？',
    answer: '美容サロン・アイラッシュ、鍼灸院・整骨院、介護施設・デイサービス、病院・クリニックなど、医療・福祉・美容業界の施設が対象です。対象か不明な場合はお気軽にお問い合わせください。',
  },
  {
    question: '掲載内容はあとから変更できますか？',
    answer: 'はい、掲載後もいつでも内容の変更が可能です。メニューや料金の更新、写真の差し替えなど、担当者にご連絡いただければ対応いたします。',
  },
];

export default function SalonPage() {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const {
    register,
    handleSubmit,
    trigger,
    setValue,
    watch,
    reset,
    formState: { errors, dirtyFields },
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

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!submitted && (step > 1 || Object.keys(dirtyFields).length > 0)) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [step, submitted, dirtyFields]);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    setValue('phone', formatted, { shouldValidate: true });
  };

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const scrollToFormTop = () => {
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const nextStep = async () => {
    const schema = stepSchemas[step - 1];
    const fields = Object.keys(schema.shape) as (keyof SalonFormValues)[];
    const valid = await trigger(fields);
    if (valid) {
      setStep(step + 1);
      scrollToFormTop();
    }
  };

  const prevStep = () => {
    setStep(step - 1);
    scrollToFormTop();
  };

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

      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          type: 'salon',
          data: {
            facility_name: data.facility_name,
            business_type: data.business_type,
            representative_name: data.representative_name,
            phone: data.phone,
            email: data.email,
          },
        }),
      }).catch(() => {});

      reset();
      setStep(1);
      setPhotoFile(null);
      setSubmitted(true);
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
            <span className="text-primary">必要な人に届ける</span>
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
                icon: '📢',
                title: '業界特化の掲載',
                desc: '業界に特化しているから、あなたの施設を探している人に情報が届きます。',
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
              { icon: '📋', title: '店舗プロフィール掲載', desc: 'メニュー・料金・写真を掲載して、あなたの施設の魅力を求職者・お客様に届けます。' },
              { icon: '👥', title: '予約・来店促進', desc: '業界特化だから、あなたの施設を必要としているお客様に情報が届きます。' },
              { icon: '📊', title: '専任担当サポート', desc: '掲載から採用まで、専任の担当者がサポート。運用の手間を最小限に抑えます。' },
            ].map((item) => (
              <div key={item.title} className="card text-center">
                <div className="text-3xl mb-3">{item.icon}</div>
                <h3 className="text-lg font-bold mb-2">{item.title}</h3>
                <p className="text-gray-600 text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Flow */}
      <section className="bg-white">
        <div className="section-container">
          <h2 className="section-title">ご利用の流れ</h2>
          <div className="grid sm:grid-cols-4 gap-6 max-w-4xl mx-auto">
            {[
              { step: '1', title: 'フォーム入力', desc: '基本情報とPR文を入力（約3分）' },
              { step: '2', title: '担当者連絡', desc: '2営業日以内にご連絡します' },
              { step: '3', title: '掲載開始', desc: '内容確認後、すぐに掲載スタート' },
              { step: '4', title: '集客開始', desc: 'お客様からの反響が届きます' },
            ].map((item, i) => (
              <div key={item.step} className="text-center">
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold mx-auto mb-4 bg-primary">
                  {item.step}
                </div>
                <h3 className="font-bold mb-2">{item.title}</h3>
                <p className="text-gray-600 text-sm">{item.desc}</p>
                {i < 3 && (
                  <div className="hidden sm:block text-primary text-2xl mt-4">&rarr;</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Form */}
      <section className="bg-gray-50" ref={formRef}>
        <div className="section-container">
          <h2 className="section-title">無料掲載登録</h2>
          <div className="max-w-2xl mx-auto">
            {submitted ? (
              <div className="card text-center py-12">
                <div className="text-5xl mb-4">&#10003;</div>
                <h3 className="text-2xl font-bold mb-3">登録が完了しました</h3>
                <p className="text-gray-600 mb-8">
                  担当者より2営業日以内にご連絡いたします。<br />
                  しばらくお待ちください。
                </p>
                <Link href="/" className="btn-primary">
                  トップページへ戻る
                </Link>
              </div>
            ) : (
            <>
            <StepIndicator currentStep={step} totalSteps={3} labels={stepLabels} />

            <form onSubmit={handleSubmit(() => setShowConfirm(true))} className="card">
              {/* Step 1 */}
              {step === 1 && (
                <div className="space-y-5">
                  <div>
                    <label htmlFor="salon-facility-name" className="form-label">施設名 <span className="text-red-500">*</span></label>
                    <input id="salon-facility-name" {...register('facility_name')} className="form-input" placeholder="例：リラクゼーションサロン ABC" />
                    {errors.facility_name && <p className="form-error">{errors.facility_name.message}</p>}
                  </div>
                  <div>
                    <label htmlFor="salon-business-type" className="form-label">業種 <span className="text-red-500">*</span></label>
                    <select id="salon-business-type" {...register('business_type')} className="form-input">
                      <option value="">選択してください</option>
                      {businessTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {errors.business_type && <p className="form-error">{errors.business_type.message}</p>}
                  </div>
                  <div>
                    <label htmlFor="salon-representative" className="form-label">代表者名 <span className="text-red-500">*</span></label>
                    <input id="salon-representative" {...register('representative_name')} className="form-input" placeholder="例：山田 太郎" />
                    {errors.representative_name && <p className="form-error">{errors.representative_name.message}</p>}
                  </div>
                  <div>
                    <label htmlFor="salon-contact-name" className="form-label">担当者名 <span className="text-red-500">*</span></label>
                    <input id="salon-contact-name" {...register('contact_name')} className="form-input" placeholder="例：山田 花子" />
                    {errors.contact_name && <p className="form-error">{errors.contact_name.message}</p>}
                  </div>
                  <div>
                    <label htmlFor="salon-email" className="form-label">メールアドレス <span className="text-red-500">*</span></label>
                    <input id="salon-email" {...register('email')} type="email" className="form-input" placeholder="example@email.com" />
                    {errors.email && <p className="form-error">{errors.email.message}</p>}
                  </div>
                  <div>
                    <label htmlFor="salon-phone" className="form-label">電話番号 <span className="text-red-500">*</span></label>
                    <input
                      id="salon-phone"
                      {...register('phone')}
                      type="tel"
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
                    <label htmlFor="salon-postal-code" className="form-label">郵便番号</label>
                    <input id="salon-postal-code" {...register('postal_code')} className="form-input" placeholder="1234567（ハイフンなし）" maxLength={7} />
                    {errors.postal_code && <p className="form-error">{errors.postal_code.message}</p>}
                  </div>
                  <div>
                    <label htmlFor="salon-address" className="form-label">住所</label>
                    <input id="salon-address" {...register('address')} className="form-input" placeholder="例：東京都渋谷区..." />
                  </div>
                  <div>
                    <label htmlFor="salon-business-hours" className="form-label">営業時間</label>
                    <input id="salon-business-hours" {...register('business_hours')} className="form-input" placeholder="例：10:00〜20:00" />
                  </div>
                  <div>
                    <label htmlFor="salon-regular-holiday" className="form-label">定休日</label>
                    <input id="salon-regular-holiday" {...register('regular_holiday')} className="form-input" placeholder="例：毎週月曜日" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="salon-seat-count" className="form-label">席数・ベッド数</label>
                      <input id="salon-seat-count" {...register('seat_count', { valueAsNumber: true })} type="number" min="0" className="form-input" />
                    </div>
                    <div>
                      <label htmlFor="salon-staff-count" className="form-label">スタッフ数</label>
                      <input id="salon-staff-count" {...register('staff_count', { valueAsNumber: true })} type="number" min="0" className="form-input" />
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
                    <label htmlFor="salon-pr-text" className="form-label">PR文</label>
                    <textarea
                      id="salon-pr-text"
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
                    <label htmlFor="salon-start-date" className="form-label">希望掲載開始日</label>
                    <input id="salon-start-date" {...register('desired_start_date')} type="date" className="form-input" />
                  </div>
                  <label className="flex items-start gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      className="mt-0.5 rounded border-gray-300"
                    />
                    <span>
                      <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline">プライバシーポリシー</a>
                      および
                      <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline">利用規約</a>
                      に同意する
                    </span>
                  </label>
                  <div className="flex gap-4">
                    <button type="button" onClick={prevStep} className="btn-outline flex-1">
                      戻る
                    </button>
                    <button type="submit" disabled={submitting || !agreed} className="btn-primary flex-1">
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
            </>
            )}
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
