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
  // .trim(): 前後空白を除去してから長さを検証・保存する（スペースのみの入力を弾く恒久対応）。
  customer_name: z.string().trim().min(1, 'お名前は必須です').max(100),
  email: z.string().email('正しいメールアドレスを入力してください').max(254),
  phone: phoneField(),
  // BookingFlow は備考未入力時に note: null を送る（phone と同様）。optional だけだと null を
  // 弾き、備考なしのオンライン予約が一律 400 になるため、phone と揃えて nullable も許可する。
  note: z.string().max(500, '備考は500文字以内で入力してください').optional().nullable(),
  total_price: z.number().min(0).max(9999999).nullable(),
  points_used: z.number().int().min(0).max(9999999).optional(),
})
  // メニュー必須（無メニュー予約の禁止・2026年7月15日 恒久予防）。UI(BookingFlow)は常に1件以上の
  // メニュー選択を強制するが、schema 上 menu_id は nullable・menu_ids は optional なため、PostgREST や
  // curl で /api/booking を直接叩くと menu_id/menu_ids を双方未指定にできる。その場合サーバー側の価格
  // 計算・指名料加算・menu_staff 担当制チェックが丸ごとスキップされ、serverTotalPrice=null の予約が
  // 生成される（指名料の取りこぼし・担当外スタッフの予約成立・null 価格予約）。ここで入口(zod)の関所
  // として「menu_id か menu_ids のいずれか必須」を強制し、無メニュー予約を parse 時点で 400 拒否する
  // （症状経路の個別塞ぎではなく、無メニュー状態自体を発生させない真の予防）。この保証により route 側の
  // serverTotalPrice は常に数値となり、null 価格前提の分岐を持たずに済む。
  .refine(
    (d) => d.menu_id != null || (Array.isArray(d.menu_ids) && d.menu_ids.length > 0),
    { message: 'メニューを選択してください', path: ['menu_id'] },
  );

export type BookingFormData = z.infer<typeof bookingSchema>;
