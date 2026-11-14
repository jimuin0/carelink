import { z } from 'zod';
import { phoneField } from './phone';

/** The facility inquiry form and API accept the same normalized fields. */
export const facilityInquirySchema = z.object({
  name: z.string().trim().min(1, 'お名前を入力してください').max(100, '100文字以内で入力してください'),
  email: z.string().email('正しいメールアドレスを入力してください').max(254, '254文字以内で入力してください'),
  // 全角数字・全角ハイフン・空白を半角へ寄せてから検証する（他フォームと同じ phoneField）。
  // 長さは正規化後の phoneRegex が上限（最大15文字）を兼ねる。
  phone: phoneField(),
  message: z.string().trim().min(1, 'お問い合わせ内容を入力してください').max(1000, '1000文字以内で入力してください'),
});
