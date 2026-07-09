import { z } from 'zod';
import { phoneField } from './phone';

/**
 * お問い合わせフォームの共有スキーマ（監査F6の根治）。
 *
 * 従来はクライアント(contact/page.tsx)とサーバ(api/contact/route.ts)で別々に zod を
 * 手書きしており、電話番号はクライアント厳格・サーバ緩い(max20のみ)の逆転、name は
 * クライアントに上限が無い等のドリフトが起きていた。単一スキーマに一元化し、
 * 両者が同じ規則で検証する。電話は phoneField で全角正規化＋形式検証。
 */
export const contactSchema = z.object({
  // .trim(): 前後空白を除去してから長さを検証・保存する（スペースのみの入力を弾く恒久対応）。
  name: z.string().trim().min(1, 'お名前を入力してください').max(100, '100文字以内で入力してください'),
  email: z.string().email('正しいメールアドレスを入力してください').max(254),
  phone: phoneField(),
  inquiry_type: z.string().min(1, 'お問い合わせ種別を選択してください').max(100),
  message: z.string().trim().min(1, '内容を入力してください').max(5000, '5000文字以内で入力してください'),
});

export type ContactFormData = z.infer<typeof contactSchema>;
