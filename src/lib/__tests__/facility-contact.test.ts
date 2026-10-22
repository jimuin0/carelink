import { isDialablePhone, bookingEmailShopContact } from '@/lib/facility-contact';

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

// お客様向け予約メール（ゲスト予約の連絡先）に載せる値。
describe('bookingEmailShopContact', () => {
  it('公開中の店舗は電話番号と slug を返す', () => {
    expect(bookingEmailShopContact({ slug: 'synthetic-shop', phone: '03-1234-5678', status: 'published' }))
      .toEqual({ facilityPhone: '03-1234-5678', facilitySlug: 'synthetic-shop' });
  });
  it('非公開の店舗は slug を返さない（店舗ページが 404 になる）・電話にならない番号も返さない', () => {
    expect(bookingEmailShopContact({ slug: 'synthetic-shop', phone: 'javascript:alert(1)', status: 'draft' }))
      .toEqual({ facilityPhone: null, facilitySlug: null });
  });
  it('slug が空なら返さない', () => {
    expect(bookingEmailShopContact({ slug: '', phone: null, status: 'published' })).toEqual({ facilityPhone: null, facilitySlug: null });
  });
  it.each([null, undefined])('店舗の行が無い %p は両方 null', (row) => {
    expect(bookingEmailShopContact(row)).toEqual({ facilityPhone: null, facilitySlug: null });
  });
});
