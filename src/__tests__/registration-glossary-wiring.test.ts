/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REGISTRATION_TERMS } from '@/lib/registration-glossary';

/**
 * 掲載申込の導線で、同じものを「登録／掲載申し込み／申込」「施設／店舗」「業種／業態」
 * 「ネット予約／オンライン予約」と画面ごとに呼び分けていた。用語は registration-glossary.ts に集め、
 * 下の画面・メールでは揺れた語を使わない（コメントは対象外）。
 */
const BANNED = ['掲載申し込み', 'オンライン予約', '業態', '登録が完了しました', '施設名', '施設を作成'];
// 申込フォーム（RegisterForm）の欄名はまだ「施設名」なので、それを指す紹介ページの文だけは
// 欄名に合わせて残す（フォームの欄名を変えるときに一緒に外す）。
const FILES: [string, string[]][] = [
  ['src/app/admin/onboarding/page.tsx', BANNED],
  ['src/app/register/complete/page.tsx', BANNED],
  ['src/components/register/RegistrationReceipt.tsx', BANNED],
  ['src/components/register/RegisterLanding.tsx', BANNED.filter(word => word !== '施設名')],
  ['src/lib/facility-welcome-delivery.ts', BANNED],
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
  'src/components/register/RegistrationReceipt.tsx', 'src/lib/facility-welcome-delivery.ts'])('%s reads its words from the glossary', file => {
  expect(readFileSync(join(process.cwd(), file), 'utf8')).toMatch(/import \{ REGISTRATION_TERMS as T \} from '(@\/lib|\.)\/registration-glossary';/);
});
