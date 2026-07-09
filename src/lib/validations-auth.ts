import { z } from 'zod';
import { phoneField } from './phone';

/**
 * LINE ログイン用の合成メール（`line_...@line.carelink.local`）は、パスワード認証の
 * email/password フローから登録・ログイン・パスワード再設定できてはならない。
 * 予約ドメインを第三者が先回り登録すると、被害者の LINE 初回ログインを乗っ取れる
 * （監査A1）。合成メール本体の予測不能化（callback 側の HMAC 導出）が主防御で、
 * ここはアプリ自身のフォーム経路に対する多層防御として予約ドメインを拒否する。
 */
const RESERVED_LINE_EMAIL_DOMAIN = '@line.carelink.local';
const notReservedLineEmail = (email: string): boolean =>
  !email.toLowerCase().endsWith(RESERVED_LINE_EMAIL_DOMAIN);
const reservedLineEmailMessage = 'このメールアドレスは使用できません';

export const loginSchema = z.object({
  email: z.string().email('正しいメールアドレスを入力してください').max(254)
    .refine(notReservedLineEmail, reservedLineEmailMessage),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください').max(128),
});

export const signupSchema = z.object({
  // .trim(): 前後空白を除去してから長さを検証・保存する（スペースのみの入力を弾く恒久対応）。
  display_name: z.string().trim().min(1, 'お名前を入力してください').max(50),
  email: z.string().email('正しいメールアドレスを入力してください').max(254)
    .refine(notReservedLineEmail, reservedLineEmailMessage),
  // お名前・電話番号・住所(都道府県)はアカウント登録時点で必須化(2026年7月6日・神原さん指摘)。
  // でたらめな電話番号を弾くため予約フォーム等と同じ phoneField() の書式検証を通す。
  phone: phoneField({ required: true }),
  prefecture: z.string().min(1, '都道府県を選択してください').max(20),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください').max(128),
  password_confirm: z.string().max(128),
}).refine((data) => data.password === data.password_confirm, {
  message: 'パスワードが一致しません',
  path: ['password_confirm'],
});

export type LoginFormData = z.infer<typeof loginSchema>;
export type SignupFormData = z.infer<typeof signupSchema>;
