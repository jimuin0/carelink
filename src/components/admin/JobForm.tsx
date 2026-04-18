'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { jobFormSchema, EMPLOYMENT_TYPES, type JobFormInput, type JobFormValues } from '@/lib/jobs';

export type JobFormProps = {
  defaultValues?: Partial<JobFormInput>;
  submitLabel: string;
  submitting?: boolean;
  onSubmit: (values: JobFormValues) => void | Promise<void>;
  onCancel?: () => void;
  onDelete?: () => void;
};

export default function JobForm({
  defaultValues,
  submitLabel,
  submitting,
  onSubmit,
  onCancel,
  onDelete,
}: JobFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<JobFormInput, unknown, JobFormValues>({
    resolver: zodResolver(jobFormSchema),
    defaultValues: {
      title: '',
      job_type: '',
      employment_type: '正社員',
      salary_min: '',
      salary_max: '',
      salary_note: '',
      description: '',
      requirements: '',
      benefits: '',
      ...defaultValues,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-xl shadow-sm p-6 space-y-4">
      <div>
        <label htmlFor="job-title" className="form-label">
          求人タイトル <span className="text-red-500">*</span>
        </label>
        <input id="job-title" {...register('title')} className="form-input" placeholder="美容師（スタイリスト）募集" maxLength={100} />
        {errors.title && <p role="alert" className="text-xs text-red-500 mt-1">{errors.title.message}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="job-type" className="form-label">
            職種 <span className="text-red-500">*</span>
          </label>
          <input id="job-type" {...register('job_type')} className="form-input" placeholder="美容師 / 看護師 / 介護士 など" maxLength={50} />
          {errors.job_type && <p role="alert" className="text-xs text-red-500 mt-1">{errors.job_type.message}</p>}
        </div>
        <div>
          <label htmlFor="employment-type" className="form-label">
            雇用形態 <span className="text-red-500">*</span>
          </label>
          <select id="employment-type" {...register('employment_type')} className="form-input">
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {errors.employment_type && <p role="alert" className="text-xs text-red-500 mt-1">{errors.employment_type.message}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="salary-min" className="form-label">給与（下限・円）</label>
          <input id="salary-min" type="number" min={0} {...register('salary_min')} className="form-input" placeholder="220000" />
          {errors.salary_min && <p role="alert" className="text-xs text-red-500 mt-1">{errors.salary_min.message}</p>}
        </div>
        <div>
          <label htmlFor="salary-max" className="form-label">給与（上限・円）</label>
          <input id="salary-max" type="number" min={0} {...register('salary_max')} className="form-input" placeholder="350000" />
          {errors.salary_max && <p role="alert" className="text-xs text-red-500 mt-1">{errors.salary_max.message}</p>}
        </div>
      </div>

      <div>
        <label htmlFor="salary-note" className="form-label">給与備考</label>
        <input id="salary-note" {...register('salary_note')} className="form-input" placeholder="経験・能力により応相談" maxLength={200} />
      </div>

      <div>
        <label htmlFor="job-desc" className="form-label">仕事内容</label>
        <textarea id="job-desc" {...register('description')} className="form-input" rows={5} maxLength={3000} />
      </div>

      <div>
        <label htmlFor="job-req" className="form-label">必須スキル・応募資格</label>
        <textarea id="job-req" {...register('requirements')} className="form-input" rows={3} maxLength={2000} />
      </div>

      <div>
        <label htmlFor="job-benefits" className="form-label">福利厚生</label>
        <textarea id="job-benefits" {...register('benefits')} className="form-input" rows={3} maxLength={2000} />
      </div>

      <div className="flex gap-3 pt-4">
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:underline">
            戻る
          </button>
        )}
        <button type="submit" disabled={submitting} className="btn-primary flex-1 !py-3">
          {submitting ? '送信中...' : submitLabel}
        </button>
      </div>

      {onDelete && (
        <div className="pt-2 border-t">
          <button type="button" onClick={onDelete} className="text-sm text-red-500 hover:underline">
            この求人を削除
          </button>
        </div>
      )}
    </form>
  );
}
