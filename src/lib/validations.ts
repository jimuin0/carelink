import { z } from 'zod';

// Phone format helper (Japanese phone: 090-1234-5678, 03-1234-5678, etc.)
const phoneRegex = /^0\d{1,4}-?\d{1,4}-?\d{3,4}$/;

// Salon form schemas (per step)
export const salonStep1Schema = z.object({
  facility_name: z.string().min(1, '施設名を入力してください').max(200, '200文字以内で入力してください'),
  business_type: z.string().min(1, '業種を選択してください').max(50),
  representative_name: z.string().min(1, '代表者名を入力してください').max(100, '100文字以内で入力してください'),
  contact_name: z.string().min(1, '担当者名を入力してください').max(100, '100文字以内で入力してください'),
  email: z.string().email('正しいメールアドレスを入力してください').max(254),
  phone: z.string().min(1, '電話番号を入力してください').regex(phoneRegex, '正しい電話番号を入力してください'),
  contact_phone: z.string().regex(phoneRegex, '正しい電話番号を入力してください').or(z.literal('')).optional(),
  website: z.string().max(2000).url('正しいURLを入力してください').or(z.literal('')).optional(),
});

export const salonStep2Schema = z.object({
  postal_code: z.string().regex(/^(\d{3}-?\d{4}|\d{7})?$/, '郵便番号を正しく入力してください（例: 5600001）').or(z.literal('')).optional(),
  address: z.string().max(500, '500文字以内で入力してください').optional(),
  building_name: z.string().max(200).optional(),
  nearest_station: z.string().max(200).optional(),
  business_hours: z.string().max(200).optional(),
  regular_holiday: z.string().max(200).optional(),
  seat_count: z.union([z.number().int().min(0).max(9999), z.nan()]).optional().nullable(),
  staff_count: z.union([z.number().int().min(0).max(9999), z.nan()]).optional().nullable(),
  has_parking: z.boolean().optional(),
  features: z.array(z.string().max(50)).max(20).optional(),
});

export const salonStep3Schema = z.object({
  pr_text: z.string().max(1000, '1000文字以内で入力してください').optional(),
  desired_start_date: z.string().optional(),
});

export const salonFullSchema = salonStep1Schema.merge(salonStep2Schema).merge(salonStep3Schema);
export type SalonFormValues = z.infer<typeof salonFullSchema>;

// Phone auto-hyphen
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  // 携帯番号（090/080/070/050）: 3-4-4
  if (/^0[5789]0/.test(digits)) {
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
  }
  // 固定電話（03/06等 2桁市外局番）: 2-4-4
  if (/^0[36]/.test(digits)) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  // その他固定電話（3桁市外局番）: 3-3-4
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

// Re-export from constants for single source of truth
export { businessTypes } from './constants';
