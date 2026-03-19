import { z } from 'zod';

// Phone format helper
const phoneRegex = /^[\d-]+$/;
const katakanaRegex = /^[ァ-ヶー]+$/;

// Salon form schemas (per step)
export const salonStep1Schema = z.object({
  facility_name: z.string().min(1, '施設名を入力してください'),
  business_type: z.string().min(1, '業種を選択してください'),
  representative_name: z.string().min(1, '代表者名を入力してください'),
  contact_name: z.string().min(1, '担当者名を入力してください'),
  email: z.string().email('正しいメールアドレスを入力してください'),
  phone: z.string().min(1, '電話番号を入力してください').regex(phoneRegex, '正しい電話番号を入力してください'),
});

export const salonStep2Schema = z.object({
  postal_code: z.string().regex(/^(\d{7})?$/, '7桁の数字で入力してください').or(z.literal('')).optional(),
  address: z.string().optional(),
  business_hours: z.string().optional(),
  regular_holiday: z.string().optional(),
  seat_count: z.union([z.number().int().min(0), z.nan()]).optional().nullable(),
  staff_count: z.union([z.number().int().min(0), z.nan()]).optional().nullable(),
});

export const salonStep3Schema = z.object({
  pr_text: z.string().max(500, '500文字以内で入力してください').optional(),
  desired_start_date: z.string().optional(),
});

export const salonFullSchema = salonStep1Schema.merge(salonStep2Schema).merge(salonStep3Schema);
export type SalonFormValues = z.infer<typeof salonFullSchema>;

// Job seeker form schemas (per step)
export const jobStep1Schema = z.object({
  full_name: z.string().min(1, '氏名を入力してください'),
  furigana: z.string().min(1, 'フリガナを入力してください').regex(katakanaRegex, '全角カタカナで入力してください'),
  birth_date: z.string().optional(),
  gender: z.string().optional(),
  phone: z.string().min(1, '電話番号を入力してください').regex(phoneRegex, '正しい電話番号を入力してください'),
  email: z.string().email('正しいメールアドレスを入力してください'),
  postal_code: z.string().regex(/^(\d{7})?$/, '7桁の数字で入力してください').or(z.literal('')).optional(),
  address: z.string().optional(),
});

export const jobStep2Schema = z.object({
  job_type: z.string().min(1, '職種を選択してください'),
  certifications: z.array(z.string()).optional(),
  experience_years: z.string().optional(),
  education: z.string().optional(),
  previous_job: z.string().optional(),
});

export const jobStep3Schema = z.object({
  desired_employment_type: z.array(z.string()).optional(),
  desired_location: z.string().optional(),
  desired_salary: z.string().optional(),
  self_pr: z.string().max(1000, '1000文字以内で入力してください').optional(),
});

export const jobFullSchema = jobStep1Schema.merge(jobStep2Schema).merge(jobStep3Schema);
export type JobFormValues = z.infer<typeof jobFullSchema>;

// Phone auto-hyphen
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
}

// Business types
export const businessTypes = [
  '美容サロン・アイラッシュ',
  '鍼灸院',
  '整骨院',
  '介護施設・デイサービス',
  '病院・クリニック',
  'その他',
];

// Job types
export const jobTypes = [
  '介護士・ヘルパー',
  '鍼灸師・柔道整復師',
  'アイリスト・美容師',
  '看護師・准看護師',
  'その他',
];

// Certifications
export const certificationOptions = [
  '介護福祉士',
  'ヘルパー2級',
  'はり師',
  'きゅう師',
  '柔道整復師',
  '看護師',
  '准看護師',
  'アイリスト検定',
  'その他',
];

// Experience years
export const experienceYears = [
  '未経験',
  '1年未満',
  '1〜3年',
  '3〜5年',
  '5年以上',
];

// Employment types
export const employmentTypes = [
  '正社員',
  'パート・アルバイト',
  '業務委託・フリーランス',
  '派遣',
];

// Gender options
export const genderOptions = ['男性', '女性', 'その他', '回答しない'];
