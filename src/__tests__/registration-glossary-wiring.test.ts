/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REGISTRATION_TERMS } from '@/lib/registration-glossary';
import { SALON_FIELD_MESSAGES } from '@/lib/salon-field-errors';
import { salonStep1Schema } from '@/lib/validations';

/**
 * 掲載申込の導線で、同じものを「登録／掲載申し込み／申込」「施設／店舗」「業種／業態」
 * 「ネット予約／オンライン予約」と画面ごとに呼び分けていた。用語は registration-glossary.ts に集め、
 * 下の画面・メールでは揺れた語を使わない（コメントは対象外）。
 */
const BANNED = ['掲載申し込み', 'オンライン予約', '業態', '登録が完了しました', '施設名', '施設を作成'];
// 申込フォーム（RegisterForm）・欄の検証文言（salon-field-errors）・申込者への受付メール
// （salon-outbox-delivery）・送信結果不明の案内（salon-registration-delivery）・店舗オーナー宛メール（email.ts）も
// 同じ語にそろえた（2026年10月23日）。以前はフォームの欄名が「施設名」、受付メールが「掲載申し込み」「施設名：」、
// 結果不明の案内が「登録済みの可能性」で、画面ごとに別の手続きに見えた。
const FILES: [string, string[]][] = [
  ['src/app/admin/onboarding/page.tsx', BANNED],
  ['src/app/register/complete/page.tsx', BANNED],
  ['src/components/register/RegistrationReceipt.tsx', BANNED],
  ['src/components/register/RegisterLanding.tsx', BANNED],
  ['src/components/register/RegisterForm.tsx', BANNED],
  ['src/lib/facility-welcome-delivery.ts', BANNED],
  ['src/lib/salon-field-errors.ts', [...BANNED, '施設写真']],
  ['src/lib/salon-outbox-delivery.ts', [...BANNED, '施設掲載申込']],
  ['src/lib/salon-registration-delivery.ts', [...BANNED, '登録済み']],
  ['src/app/register/page.tsx', [...BANNED, '掲載登録']],
];

function withoutComments(source: string): string {
  return source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('the glossary fixes one word per concept', () => {
  expect(REGISTRATION_TERMS).toEqual({
    application: '掲載申込', account: '店舗アカウント', shop: '店舗', shopName: '店舗名',
    businessType: '業種', onlineBooking: 'ネット予約',
  });
});

test.each(FILES)('%s uses the glossary terms, not the old variants', (file, banned) => {
  const code = withoutComments(readFileSync(join(process.cwd(), file), 'utf8'));
  for (const word of banned) expect({ file, word, found: code.includes(word) }).toEqual({ file, word, found: false });
});

test.each(['src/app/admin/onboarding/page.tsx', 'src/app/register/complete/page.tsx',
  'src/components/register/RegistrationReceipt.tsx', 'src/lib/facility-welcome-delivery.ts',
  'src/components/register/RegisterForm.tsx', 'src/lib/salon-field-errors.ts', 'src/lib/salon-outbox-delivery.ts',
  'src/app/auth/signup/page.tsx', 'src/lib/email.ts'])('%s reads its words from the glossary', file => {
  expect(readFileSync(join(process.cwd(), file), 'utf8')).toMatch(/import \{ REGISTRATION_TERMS as T \} from '(@\/lib|\.)\/registration-glossary';/);
});

test('申込フォームの欄名と、その欄の検証文言が同じ語（店舗名）を指す', () => {
  expect(SALON_FIELD_MESSAGES.facility_name.startsWith(REGISTRATION_TERMS.shopName)).toBe(true);
  expect(SALON_FIELD_MESSAGES.photo_urls.startsWith(`${REGISTRATION_TERMS.shop}の写真`)).toBe(true);
  const empty = salonStep1Schema.shape.facility_name.safeParse('');
  expect(empty.success).toBe(false);
  expect(empty.error?.issues[0].message).toBe(`${REGISTRATION_TERMS.shopName}を入力してください`);
});
