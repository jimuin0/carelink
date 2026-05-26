import { z } from 'zod';

export const EMPLOYMENT_TYPES = ['正社員', '契約社員', 'アルバイト・パート', '業務委託', '派遣'] as const;

export const jobFormSchema = z
  .object({
    title: z.string().trim().min(1, 'タイトルを入力してください').max(120, '120文字以内で入力してください'),
    job_type: z.string().trim().min(1, '職種を入力してください').max(60),
    employment_type: z.enum(EMPLOYMENT_TYPES, { message: '雇用形態を選択してください' }),
    salary_min: z
      .union([z.string(), z.number()])
      .optional()
      .transform((v) => (v === '' || v == null ? null : Number(v)))
      .refine((v) => v === null || (Number.isFinite(v) && v >= 0), '0以上の数値を入力'),
    salary_max: z
      .union([z.string(), z.number()])
      .optional()
      .transform((v) => (v === '' || v == null ? null : Number(v)))
      .refine((v) => v === null || (Number.isFinite(v) && v >= 0), '0以上の数値を入力'),
    salary_note: z.string().trim().max(200).optional().or(z.literal('')),
    description: z.string().trim().max(4000).optional().or(z.literal('')),
    requirements: z.string().trim().max(2000).optional().or(z.literal('')),
    benefits: z.string().trim().max(2000).optional().or(z.literal('')),
  })
  .refine(
    // null チェック後は transform により両者は必ず number（?? 0 は到達不可）
    (v) => v.salary_min === null || v.salary_max === null || (v.salary_max as number) >= (v.salary_min as number),
    { message: '上限は下限以上にしてください', path: ['salary_max'] },
  );

export type JobFormInput = z.input<typeof jobFormSchema>;
export type JobFormValues = z.output<typeof jobFormSchema>;

export type FacilityJob = {
  id: string;
  facility_id: string;
  title: string;
  job_type: string;
  employment_type: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_note: string | null;
  description: string | null;
  requirements: string | null;
  benefits: string | null;
  created_at: string;
  updated_at: string;
};
