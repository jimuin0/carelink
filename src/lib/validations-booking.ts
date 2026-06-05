import { z } from 'zod';
import { canonicalizeEmail } from './email-canonical';

const phoneRegex = /^0\d{1,4}-?\d{1,4}-?\d{3,4}$/;

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
    .refine((date) => date >= getTodayString(), '過去の日付は指定できません')
    .refine((date) => date <= getMaxDateString(), '1年以上先の日付は指定できません'),
  start_time: timeString,
  end_time: timeString,
  // 保存時に名前は前後空白を除去（突合の表記ゆれ・顧客分裂を防ぐ）
  customer_name: z.string().min(1, 'お名前は必須です').max(100).transform((v) => v.trim()),
  // email は保存・突合で正規化を一致させる。小文字化に加え Gmail/googlemail のドット・"+tag"・
  // ドメイン別名を canonical 化する（canonicalizeEmail）。Gmail は f.o.o@/foo+x@/googlemail を同一受信箱に
  // 届けるため、生 email を識別キーにすると同一人物が別客に分裂し new_customer クーポンの複数取得（金銭）・
  // repeat 誤拒否・RFM 分裂を招く。保存値を canonical に統一して全突合（履歴照合・集計）を正す（真の予防）。
  // 非 Gmail はドット/"+"の意味がプロバイダ依存のため小文字化のみ（別人の誤併合を防ぐ）。
  email: z.string().email('正しいメールアドレスを入力してください').max(254).transform((v) => canonicalizeEmail(v)),
  phone: z.string().regex(phoneRegex, '正しい電話番号を入力してください').or(z.literal('')).optional().nullable(),
  note: z.string().max(500, '備考は500文字以内で入力してください').optional(),
  total_price: z.number().min(0).max(9999999).nullable(),
  points_used: z.number().min(0).max(9999999).optional(),
});

export type BookingFormData = z.infer<typeof bookingSchema>;
