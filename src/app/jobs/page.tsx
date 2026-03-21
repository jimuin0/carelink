'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import {
  jobStep1Schema,
  jobStep2Schema,
  jobStep3Schema,
  jobFullSchema,
  type JobFormValues,
  formatPhone,
  jobTypes,
  certificationOptions,
  experienceYears,
  employmentTypes,
  genderOptions,
} from '@/lib/validations';
import StepIndicator from '@/components/StepIndicator';
import PhotoUpload from '@/components/PhotoUpload';
import Spinner from '@/components/Spinner';
import Toast from '@/components/Toast';
import FAQ from '@/components/FAQ';
import ConfirmDialog from '@/components/ConfirmDialog';

const stepSchemas = [jobStep1Schema, jobStep2Schema, jobStep3Schema];
const stepLabels = ['基本情報', '職歴・資格', '希望条件'];

const faqItems = [
  { question: '登録は無料ですか？', answer: 'はい、完全無料です。' },
  { question: '在職中でも登録できますか？', answer: 'はい、在職中の方も登録できます。' },
  {
    question: '個人情報はどう管理されますか？',
    answer: 'SSL暗号化通信・Supabaseによる安全な管理を行っています。',
  },
];

const targetJobs = [
  { title: '介護士・ヘルパー', icon: '🏥' },
  { title: '鍼灸師・柔道整復師', icon: '💆' },
  { title: 'アイリスト・美容師', icon: '💇' },
  { title: '看護師・准看護師', icon: '🩺' },
];

export default function JobsPage() {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
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
    formState: { errors },
  } = useForm<JobFormValues>({
    resolver: zodResolver(jobFullSchema),
    mode: 'onTouched',
    defaultValues: {
      full_name: '',
      furigana: '',
      birth_date: '',
      gender: '',
      phone: '',
      email: '',
      postal_code: '',
      address: '',
      job_type: '',
      certifications: [],
      experience_years: '',
      education: '',
      previous_job: '',
      desired_employment_type: [],
      desired_location: '',
      desired_salary: '',
      self_pr: '',
    },
  });

  const selfPr = watch('self_pr') || '';

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
    const fields = Object.keys(schema.shape) as (keyof JobFormValues)[];
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


  const onSubmit = async (data: JobFormValues) => {
    setSubmitting(true);
    try {
      let photo_url: string | null = null;

      if (photoFile) {
        const fileExt = photoFile.name.split('.').pop();
        const uuid = crypto.randomUUID();
        const filePath = `job_seekers/${uuid}/photo.${fileExt}`;

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
        full_name: data.full_name,
        furigana: data.furigana,
        birth_date: data.birth_date || null,
        gender: data.gender || null,
        phone: data.phone,
        email: data.email,
        postal_code: data.postal_code || null,
        address: data.address || null,
        job_type: data.job_type,
        certifications: data.certifications?.length ? data.certifications : null,
        experience_years: data.experience_years || null,
        education: data.education || null,
        previous_job: data.previous_job || null,
        desired_employment_type: data.desired_employment_type?.length ? data.desired_employment_type : null,
        desired_location: data.desired_location || null,
        desired_salary: data.desired_salary || null,
        self_pr: data.self_pr || null,
        photo_url,
      };

      const { error } = await supabase.from('job_seekers').insert(insertData);
      if (error) throw error;

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
            あなたのスキルを、
            <br />
            <span className="text-primary">正しく評価してくれる職場へ</span>
          </h1>
          <p className="text-gray-600 text-lg sm:text-xl mb-8">
            介護士・鍼灸師・アイリスト・看護師の転職に特化
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button onClick={scrollToForm} className="btn-primary text-lg">
              無料で登録する
            </button>
            <button
              onClick={() =>
                setToast({ message: 'LINE登録は現在準備中です。フォームからご登録ください。', type: 'info' })
              }
              className="inline-flex items-center justify-center px-8 py-4 bg-[#06C755] text-white font-bold rounded-lg transition-all hover:opacity-90 active:scale-95 text-lg gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>
              LINE登録（準備中）
            </button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="bg-white">
        <div className="section-container">
          <h2 className="section-title">CareLink でできること</h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              {
                icon: '📱',
                title: 'あなたに合った求人がLINEで届く',
                desc: '希望条件に合った求人だけをLINEでお届け。情報収集の手間がゼロに。',
              },
              {
                icon: '💰',
                title: '完全無料・登録3分',
                desc: '費用は一切かかりません。簡単な登録ですぐに始められます。',
              },
              {
                icon: '🎯',
                title: '医療・福祉・美容に特化',
                desc: '業界特化だからこそ、あなたのスキルが正しく評価される求人が見つかります。',
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

      {/* Target Jobs */}
      <section className="bg-gray-50">
        <div className="section-container">
          <h2 className="section-title">対象職種</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-3xl mx-auto">
            {targetJobs.map((job) => (
              <div key={job.title} className="card text-center">
                <div className="text-3xl mb-3">{job.icon}</div>
                <p className="font-bold text-sm">{job.title}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Flow */}
      <section className="bg-white">
        <div className="section-container">
          <h2 className="section-title">登録の流れ</h2>
          <div className="grid sm:grid-cols-4 gap-6 max-w-4xl mx-auto">
            {[
              { step: '1', title: '登録', desc: '3分で簡単登録' },
              { step: '2', title: '求人が届く', desc: 'LINEで希望の求人が届く' },
              { step: '3', title: '応募', desc: '気になる求人に応募' },
              { step: '4', title: '採用', desc: '面接・内定・入社' },
            ].map((item, i) => (
              <div key={item.step} className="text-center">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold mx-auto mb-4 bg-primary"
                >
                  {item.step}
                </div>
                <h3 className="font-bold mb-2">{item.title}</h3>
                <p className="text-gray-600 text-sm">{item.desc}</p>
                {i < 3 && (
                  <div className="hidden sm:block text-primary text-2xl mt-4">→</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Form */}
      <section className="bg-gray-50" ref={formRef}>
        <div className="section-container">
          <h2 className="section-title">無料会員登録</h2>
          <div className="max-w-2xl mx-auto">
            {submitted ? (
              <div className="card text-center py-12">
                <div className="text-5xl mb-4">&#10003;</div>
                <h3 className="text-2xl font-bold mb-3">登録が完了しました</h3>
                <p className="text-gray-600 mb-8">
                  ご登録ありがとうございます。<br />
                  希望条件に合った求人情報をお届けします。
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
                    <label className="form-label">氏名 <span className="text-red-500">*</span></label>
                    <input {...register('full_name')} className="form-input" placeholder="例：山田 太郎" />
                    {errors.full_name && <p className="form-error">{errors.full_name.message}</p>}
                  </div>
                  <div>
                    <label className="form-label">フリガナ <span className="text-red-500">*</span></label>
                    <input {...register('furigana')} className="form-input" placeholder="例：ヤマダタロウ" />
                    {errors.furigana && <p className="form-error">{errors.furigana.message}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">生年月日</label>
                      <input {...register('birth_date')} type="date" className="form-input" />
                    </div>
                    <div>
                      <label className="form-label">性別</label>
                      <select {...register('gender')} className="form-input">
                        <option value="">選択してください</option>
                        {genderOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="form-label">電話番号 <span className="text-red-500">*</span></label>
                    <input
                      {...register('phone')}
                      type="tel"
                      onChange={handlePhoneChange}
                      className="form-input"
                      placeholder="090-1234-5678"
                    />
                    {errors.phone && <p className="form-error">{errors.phone.message}</p>}
                  </div>
                  <div>
                    <label className="form-label">メールアドレス <span className="text-red-500">*</span></label>
                    <input {...register('email')} type="email" className="form-input" placeholder="example@email.com" />
                    {errors.email && <p className="form-error">{errors.email.message}</p>}
                  </div>
                  <div>
                    <label className="form-label">郵便番号</label>
                    <input {...register('postal_code')} className="form-input" placeholder="1234567（ハイフンなし）" maxLength={7} />
                    {errors.postal_code && <p className="form-error">{errors.postal_code.message}</p>}
                  </div>
                  <div>
                    <label className="form-label">住所</label>
                    <input {...register('address')} className="form-input" placeholder="例：東京都渋谷区..." />
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
                    <label className="form-label">職種 <span className="text-red-500">*</span></label>
                    <select {...register('job_type')} className="form-input">
                      <option value="">選択してください</option>
                      {jobTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {errors.job_type && <p className="form-error">{errors.job_type.message}</p>}
                  </div>
                  <div>
                    <label className="form-label">保有資格（複数選択可）</label>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {certificationOptions.map((cert) => (
                        <label key={cert} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            value={cert}
                            {...register('certifications')}
                            className="rounded border-gray-300"
                          />
                          {cert}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="form-label">経験年数</label>
                    <select {...register('experience_years')} className="form-input">
                      <option value="">選択してください</option>
                      {experienceYears.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">最終学歴</label>
                    <input {...register('education')} className="form-input" placeholder="例：○○大学 卒業" />
                  </div>
                  <div>
                    <label className="form-label">前職</label>
                    <input {...register('previous_job')} className="form-input" placeholder="例：○○病院 介護士" />
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
                    <label className="form-label">希望雇用形態（複数選択可）</label>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {employmentTypes.map((type) => (
                        <label key={type} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            value={type}
                            {...register('desired_employment_type')}
                            className="rounded border-gray-300"
                          />
                          {type}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="form-label">希望勤務地</label>
                    <input {...register('desired_location')} className="form-input" placeholder="例：東京都内" />
                  </div>
                  <div>
                    <label className="form-label">希望給与</label>
                    <input {...register('desired_salary')} className="form-input" placeholder="例：月給25万円以上" />
                  </div>
                  <div>
                    <label className="form-label">自己PR</label>
                    <textarea
                      {...register('self_pr')}
                      className="form-input min-h-[120px]"
                      placeholder="あなたのアピールポイントをご記入ください"
                      maxLength={1000}
                    />
                    <div className="flex justify-between mt-1">
                      {errors.self_pr && <p className="form-error">{errors.self_pr.message}</p>}
                      <p className="text-sm text-gray-400 ml-auto">{selfPr.length}/1000</p>
                    </div>
                  </div>
                  <div>
                    <label className="form-label">顔写真</label>
                    <PhotoUpload onChange={setPhotoFile} />
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
      <section className="bg-white">
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
