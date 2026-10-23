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

/**
 * 許認可・資格の表明（`license_warranted`）としてチェックしてもらう文言。
 * 掲載申し込み（/register）・店舗作成（/admin/onboarding）の 2 画面がこれを表示する
 * （/recruit の別フォームは 2026年10月23日に撤去し /register へ転送）。
 *
 * 🔴 2026年10月23日 改訂（神原さん決定：業種「鍼灸院・整骨院」に整体を含める）。
 * 旧文言「施術は必要な資格を有する者が提供する」は、国家資格の無い整体（民間資格・無資格でも
 * 適法に営業できる）では表明として成り立たない・誤読される。資格が法令上必要な施術
 * （あん摩マッサージ指圧・はり・きゅう・柔道整復など）は、その資格者が行う、という
 * 法的な意味は残したまま、整体の店舗も事実どおりにチェックできる文言にする。
 * 利用規約 第12条（掲載者の表明保証）の「法令上必要な国家資格等を有する者が当該施術・サービスを
 * 提供すること」と同じ意味であり、規約本文は変わらない（REGISTRATION_TERMS_SHA256 は据え置き）。
 * DB は真偽値（salons.registration_license_warranted）だけを持ち、文言は保存していない。
 */
export const LICENSE_WARRANTY_TEXT =
  '当施設の運営に法令上必要な許可・免許・届出（美容所開設届、施術所開設届、診療所開設届等）をすべて完了しており、' +
  '国家資格が必要な施術（あん摩マッサージ指圧・鍼・灸・柔道整復など）は、その資格を持つ者が行っていることを表明します（必須）';
// Content fingerprint of Terms/Privacy plus their shared retirement notices.
// This identifies an edition; it does not invent a legal effective date.
export const REGISTRATION_TERMS_SHA256 = 'f803cdc1342775572d7c63da4e3d4e2c987a503517d34a612c0745e8780c524d';
export const REGISTRATION_CONSENT_REQUIRED = '利用規約・プライバシーポリシーへの同意と、必要な許認可の表明を改めて確認してください。入力は保持されています。古い画面の場合は、入力を保存して画面を更新してください。';
