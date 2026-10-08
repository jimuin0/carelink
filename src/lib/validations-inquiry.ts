import { z } from 'zod';

/** The facility inquiry form and API accept the same normalized fields. */
export const facilityInquirySchema = z.object({
  name: z.string().trim().min(1, 'お名前を入力してください').max(100, '100文字以内で入力してください'),
  email: z.string().email('正しいメールアドレスを入力してください').max(254, '254文字以内で入力してください'),
  phone: z.string().max(20, '20文字以内で入力してください')
    .regex(/^0\d{1,4}-?\d{1,4}-?\d{3,4}$/, '正しい電話番号を入力してください')
    .or(z.literal('')).optional().nullable(),
  message: z.string().trim().min(1, 'お問い合わせ内容を入力してください').max(1000, '1000文字以内で入力してください'),
});
