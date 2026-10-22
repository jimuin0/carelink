import { z } from 'zod';

/** Fresh declarations for the existing Terms/Privacy and licensing warranty.
 * Transport-only: never restored from a personal draft, treated as permission,
 * or used to backfill declarations for historical applicants. */
export const termsConsentSchema = z.object({
  terms_agreed: z.literal(true, { error: '利用規約とプライバシーポリシーへの同意が必要です' }),
}).strict();
export const registrationConsentSchema = termsConsentSchema.extend({
  license_warranted: z.literal(true),
}).strict();
export type RegistrationConsent = z.infer<typeof registrationConsentSchema>;
// Content fingerprint of Terms/Privacy plus their shared retirement notices.
// This identifies an edition; it does not invent a legal effective date.
export const REGISTRATION_TERMS_SHA256 = '6c2e672934c048a32eba2b4662c9fc8e7e1887cec7914b4b2a513f8fdb62a1d0';
export const REGISTRATION_CONSENT_REQUIRED = '利用規約・プライバシーポリシーへの同意と、必要な許認可の表明を改めて確認してください。入力は保持されています。古い画面の場合は、入力を保存して画面を更新してください。';
