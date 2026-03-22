import { z } from 'zod';

export const bookingSchema = z.object({
  facility_id: z.string().uuid(),
  staff_id: z.string().uuid().nullable(),
  menu_id: z.string().uuid().nullable(),
  coupon_id: z.string().uuid().nullable(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '正しい日付形式で入力してください'),
  start_time: z.string().regex(/^\d{2}:\d{2}/, '正しい時間形式で入力してください'),
  end_time: z.string().regex(/^\d{2}:\d{2}/, '正しい時間形式で入力してください'),
  customer_name: z.string().min(1, 'お名前は必須です'),
  email: z.string().email('正しいメールアドレスを入力してください'),
  phone: z.string().optional(),
  note: z.string().optional(),
  total_price: z.number().nullable(),
});

export type BookingFormData = z.infer<typeof bookingSchema>;
