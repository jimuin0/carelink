import { z } from 'zod';
import { isValidIsoDate } from './date-utils';
import { phoneField } from './phone';

const timeString = z.string()
  .regex(/^\d{2}:\d{2}$/, '正しい時間形式で入力してください')
  .refine((t) => {
    const [h, m] = t.split(':').map(Number);
    // \d{2} regex guarantees h and m are 0-99, so h >= 0 / m >= 0 are always true (omitted)
    return h < 24 && m < 60;
  }, '有効な時間を入力してください');

export function getTodayString() {
  // JST（UTC+9）で今日の日付を取得（Vercel=UTC環境対応）
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getMaxDateString() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  jst.setUTCFullYear(jst.getUTCFullYear() + 1);
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
    // 形式が合っていても 2026-02-30 等の不在日は regex を通る。DATE 列が拒否し 500 になる前に
    // ここで弾き、明確な 400 メッセージを返す（文字列比較の境界判定も不在日では無意味なため先に検証）。
    .refine((date) => isValidIsoDate(date), '有効な日付を入力してください')
    .refine((date) => date >= getTodayString(), '過去の日付は指定できません')
    .refine((date) => date <= getMaxDateString(), '1年以上先の日付は指定できません'),
  start_time: timeString,
  end_time: timeString,
  customer_name: z.string().min(1, 'お名前は必須です').max(100),
  email: z.string().email('正しいメールアドレスを入力してください').max(254),
  phone: phoneField(),
  // BookingFlow は備考未入力時に note: null を送る（phone と同様）。optional だけだと null を
  // 弾き、備考なしのオンライン予約が一律 400 になるため、phone と揃えて nullable も許可する。
  note: z.string().max(500, '備考は500文字以内で入力してください').optional().nullable(),
  total_price: z.number().min(0).max(9999999).nullable(),
  points_used: z.number().int().min(0).max(9999999).optional(),
});

export type BookingFormData = z.infer<typeof bookingSchema>;
