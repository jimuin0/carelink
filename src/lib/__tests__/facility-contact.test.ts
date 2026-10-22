import { isDialablePhone } from '@/lib/facility-contact';

// 店舗ページ・マイページの予約詳細・LIFF のキャンセル画面が同じ判定で tel: リンクを出す。
describe('isDialablePhone', () => {
  it.each(['03-1234-5678', '+81 3 1234 5678', '(03)1234-5678', '0312345678#1', '1234567'])('%s は電話リンクにする', (phone) => {
    expect(isDialablePhone(phone)).toBe(true);
  });

  it.each([
    ['短すぎる', '123456'],
    ['長すぎる', '0'.repeat(21)],
    ['文字を含む', '03-1234-ABCD'],
    ['URL', 'javascript:alert(1)'],
    ['全角数字', '０３１２３４５６７８'],
    ['空', ''],
  ])('%s（%s）はリンクにしない', (_label, phone) => {
    expect(isDialablePhone(phone)).toBe(false);
  });

  it.each([null, undefined, 312345678])('文字列でない値 %p はリンクにしない', (phone) => {
    expect(isDialablePhone(phone)).toBe(false);
  });
});
