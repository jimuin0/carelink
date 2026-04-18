import { z } from 'zod';

const phoneRegex = /^0\d{1,4}-?\d{1,4}-?\d{3,4}$/;

const timeString = z.string()
  .regex(/^\d{2}:\d{2}$/, '正しい時間形式で入力してください')
  .refine((t) => {
    const [h, m] = t.split(':').map(Number);
    return h >= 0 && h < 24 && m >= 0 && m < 60;
  }, '有効な時間を入力してください');

function getTodayString() {
  // JST（UTC+9）で今日の日付を取得（Vercel=UTC環境対応）
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const bookingSchema = z.object({
  facility_id: z.string().uuid(),
  staff_id: z.string().uuid().nullable(),
  menu_id: z.string().uuid().nullable(),
  // menu_ids: multi-select list; server re-validates all against DB
  menu_ids: z.array(z.string().uuid()).max(20).optional(),
  coupon_id: z.string().uuid().nullable(),
  booking_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '正しい日付形式で入力してください')
    .refine((date) => date >= getTodayString(), '過去の日付は指定できません'),
  start_time: timeString,
  end_time: timeString,
  customer_name: z.string().min(1, 'お名前は必須です').max(100),
  email: z.string().email('正しいメールアドレスを入力してください').max(254),
  phone: z.string().regex(phoneRegex, '正しい電話番号を入力してください').or(z.literal('')).optional().nullable(),
  note: z.string().max(500, '備考は500文字以内で入力してください').optional(),
  total_price: z.number().min(0).max(9999999).nullable(),
  points_used: z.number().min(0).max(9999999).optional(),
});

export type BookingFormData = z.infer<typeof bookingSchema>;
