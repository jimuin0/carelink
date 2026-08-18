/**
 * ブラウザ側に残る個人情報の後始末の検査。
 *
 * 守っているのは「退会したのに氏名・メール・電話が端末に残る」状態を作らないこと。
 * 全リロード（window.location.href = '/'）では sessionStorage が消えないため、
 * 明示的な消去が必要になる。
 */
import { BOOKING_DRAFT_PREFIX, bookingDraftKey, clearStoredPersonalData } from '../client-storage';

describe('bookingDraftKey', () => {
  it('接頭辞に施設 ID を繋げる', () => {
    expect(bookingDraftKey('facility-1')).toBe(`${BOOKING_DRAFT_PREFIX}facility-1`);
  });
});

describe('clearStoredPersonalData', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.restoreAllMocks();
  });

  it('予約下書きだけを消し、他機能の値は残す', () => {
    sessionStorage.setItem(bookingDraftKey('f1'), JSON.stringify({ email: 'a@example.com' }));
    sessionStorage.setItem(bookingDraftKey('f2'), JSON.stringify({ phone: '09000000000' }));
    sessionStorage.setItem('unrelated-feature', 'keep me');

    clearStoredPersonalData();

    expect(sessionStorage.getItem(bookingDraftKey('f1'))).toBeNull();
    expect(sessionStorage.getItem(bookingDraftKey('f2'))).toBeNull();
    expect(sessionStorage.getItem('unrelated-feature')).toBe('keep me');
  });

  it('下書きが無くても壊れない', () => {
    sessionStorage.setItem('unrelated-feature', 'keep me');
    expect(() => clearStoredPersonalData()).not.toThrow();
    expect(sessionStorage.getItem('unrelated-feature')).toBe('keep me');
  });

  it('key() が null を返しても走査を続ける', () => {
    sessionStorage.setItem(bookingDraftKey('f1'), '{}');
    // 走査中に null が混ざる実装差（仕様上 null を返し得る）でも落ちないこと。
    const realKey = sessionStorage.key.bind(sessionStorage);
    jest.spyOn(Storage.prototype, 'key').mockImplementation((index: number) =>
      index === 0 ? null : realKey(index),
    );

    expect(() => clearStoredPersonalData()).not.toThrow();
  });

  it('sessionStorage が使えなくても退会処理を妨げない', () => {
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    sessionStorage.setItem(bookingDraftKey('f1'), '{}');

    expect(() => clearStoredPersonalData()).not.toThrow();
  });
});
