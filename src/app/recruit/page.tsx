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
import { phoneField, normalizePhone } from '@/lib/phone';
import { getRecaptchaToken } from '@/lib/recaptcha-client';

// 【2026年7月16日 恒久根治】従来はこのページ固有の緩い正規表現(/^[\d-]+$/、先頭0任意・
// 全角未対応)を独自定義しており、サーバー側 /api/salons が使う共通ヘルパー phoneField()
// （予約/問い合わせ/会員登録の全箇所で使用・先頭0必須の phoneRegex + 全角→半角正規化）より
// 検証が緩かった。クライアントを通過してもサーバーで400になる不一致を解消するため、
// 正規表現を複製せず共通ヘルパーを直接importして統一する（将来のドリフト防止）。
const step1Schema = z.object({
  facility_name: z.string().min(1, '施設名を入力してください').max(100),
  business_type: z.string().min(1, '業種を選択してください'),
  representative_name: z.string().min(1, '代表者名を入力してください').max(50),
  contact_name: z.string().min(1, '担当者名を入力してください').max(50),
  email: z.string().email('正しいメールアドレスを入力してください').max(254),
  phone: phoneField({ required: true }),
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
      const recaptchaToken = await getRecaptchaToken('salons');
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
      if (!res.ok) {
        // 【2026年7月16日 恒久根治】従来はサーバーのエラーJSONを読まず固定文言
        // 'registration failed' を投げており、catch側で「登録に失敗しました: registration failed」
        // という日英混在トーストになっていた（サーバーが返す具体的な理由（バリデーション/
        // Bot検知/レート制限等）も利用者に伝わらなかった）。レスポンスJSONの error を読み取る。
        const errBody: { error?: string } | null = await res.json().catch(() => null);
        throw new Error(errBody?.error || '登録に失敗しました。時間をおいて再度お試しください。');
      }

      setDone(true);
    } catch (e: unknown) {
      // e.message は上の throw で日本語の理由（サーバーJSONのerror or 既定文言）が
      // 入っているため、そのまま表示する（"登録に失敗しました: " の二重prefixをしない）。
      setToast({ message: e instanceof Error ? e.message : '登録に失敗しました。時間をおいて再度お試しください。', type: 'error' });
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
                {/* 【2026年7月16日 恒久根治】従来は replace(/[^\d-]/g, '') を先にかけており、
                    全角数字「０９０」等が即除去され、サーバー側 normalizePhone（NFKC 全角→半角
                    正規化）が実UIから到達不能だった。normalizePhone を先に通してから絞ることで、
                    全角入力もサーバーと同じ規則で半角化してから表示・保持する。 */}
                <input {...register('phone')} maxLength={20} className="form-input w-full" value={phoneValue ? formatPhone(phoneValue) : ''} onChange={(e) => setValue('phone', normalizePhone(e.target.value).replace(/[^\d-]/g, ''))} />
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
