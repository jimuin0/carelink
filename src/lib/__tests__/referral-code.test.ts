/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_NOT_ELIGIBLE_MESSAGE,
  referralCodeFromParam,
  referralEntryPath,
  referralLoginHref,
  referralSignupHref,
} from '../referral-code';
import { safeRedirect } from '../safe-redirect';

describe('referralCodeFromParam', () => {
  test.each([
    ['ABCD2345', 'ABCD2345'],
    ['abcd2345', 'ABCD2345'],
    ['  abcd2345 ', 'ABCD2345'],
  ])('共有リンクのコード %p を入力欄の形 %p に揃える', (raw, expected) => {
    expect(referralCodeFromParam(raw)).toBe(expected);
  });

  test.each([
    [null],
    [undefined],
    [''],
    ['ABCD234'], // 7文字
    ['ABCD23456'], // 9文字
    ['ABCD0345'], // 0 は発行しない文字
    ['ABCDI345'], // I は発行しない文字
    ['ABC-2345'],
    ['<script>'],
  ])('コードの形でない %p は入力欄へ入れない', (raw) => {
    expect(referralCodeFromParam(raw)).toBeNull();
  });

  test('発行側（/api/referral）の文字種・桁数と同じ定義を使う', () => {
    expect(REFERRAL_CODE_ALPHABET).toBe('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    expect(REFERRAL_CODE_LENGTH).toBe(8);
    for (const ch of REFERRAL_CODE_ALPHABET) {
      expect(referralCodeFromParam(ch.repeat(REFERRAL_CODE_LENGTH))).toBe(ch.repeat(REFERRAL_CODE_LENGTH));
    }
  });
});

describe('共有リンクから入力画面までコードを運ぶ', () => {
  const origin = 'https://carelink-jp.com';

  test('入力画面は /mypage/referral?ref=コード', () => {
    expect(referralEntryPath('ABCD2345')).toBe('/mypage/referral?ref=ABCD2345');
  });

  test.each([
    ['会員登録', referralSignupHref, '/auth/signup'],
    ['ログイン', referralLoginHref, '/auth/login'],
  ] as const)('%s後の戻り先として ?ref= ごと入力画面へ戻る', (_label, href, path) => {
    const url = new URL(href('ABCD2345'), origin);
    expect(url.pathname).toBe(path);
    // 登録・ログイン画面と middleware が使う safeRedirect を通しても ?ref= が残ること。
    expect(safeRedirect(url.searchParams.get('redirect'), origin)).toBe('/mypage/referral?ref=ABCD2345');
  });
});

test('来店済みの方への案内は理由が分かる文言にする', () => {
  expect(REFERRAL_NOT_ELIGIBLE_MESSAGE).toBe('紹介コードは初回のご来店前の方のみご利用いただけます。');
});
