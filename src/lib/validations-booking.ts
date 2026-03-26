import { z } from 'zod';

const phoneRegex = /^0\d{1,4}-?\d{1,4}-?\d{3,4}$/;

export const bookingSchema = z.object({
  facility_id: z.string().uuid(),
  staff_id: z.string().uuid().nullable(),
  menu_id: z.string().uuid().nullable(),
  coupon_id: z.string().uuid().nullable(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '正しい日付形式で入力してください'),
  start_time: z.string().regex(/^\d{2}:\d{2}/, '正しい時間形式で入力してください'),
  end_time: z.string().regex(/^\d{2}:\d{2}/, '正しい時間形式で入力してください'),
  customer_name: z.string().min(1, 'お名前は必須です').max(100),
  email: z.string().email('正しいメールアドレスを入力してください').max(254),
  phone: z.string().regex(phoneRegex, '正しい電話番号を入力してください').or(z.literal('')).optional(),
  note: z.string().max(500, '備考は500文字以内で入力してください').optional(),
  total_price: z.number().min(0).max(9999999).nullable(),
});

export type BookingFormData = z.infer<typeof bookingSchema>;
