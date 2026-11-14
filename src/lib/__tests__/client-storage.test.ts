/**
 * ブラウザ側に残る個人情報の後始末の検査。
 *
 * 守っているのは「退会したのに氏名・メール・電話が端末に残る」状態を作らないこと。
 * 全リロード（window.location.assign(window.location.origin)）では sessionStorage が消えないため、
 * 明示的な消去が必要になる。
 */
const mockClearAll = jest.fn();
jest.mock('../salon-local-draft', () => ({ clearAllLocalSalonDrafts: () => mockClearAll() }));
import { BOOKING_DRAFT_PREFIX, bookingDraftKey, clearStoredPersonalData, clearAccountLocalData, LOCAL_DATA_CLEAR_FAILED } from '../client-storage';
import { CLIENT_BOOKING_DRAFT_META_PREFIX } from '../client-cleanup-marker';

describe('bookingDraftKey', () => {
  it('接頭辞に施設 ID を繋げる', () => {
    expect(bookingDraftKey('facility-1')).toBe(`${BOOKING_DRAFT_PREFIX}facility-1`);
  });
});

describe('verified asynchronous account local cleanup', () => {
  beforeEach(() => { jest.restoreAllMocks(); sessionStorage.clear(); mockClearAll.mockReset().mockResolvedValue(undefined); });
  it('awaits durable cleanup then removes/read-verifies booking drafts, preserving unrelated keys', async () => {
    sessionStorage.setItem(bookingDraftKey('synthetic'), 'private input'); sessionStorage.setItem('other-feature', 'keep');
    sessionStorage.setItem(`${CLIENT_BOOKING_DRAFT_META_PREFIX}synthetic`, 'non-secret generation');
    mockClearAll.mockImplementation(async () => { expect(sessionStorage.getItem(bookingDraftKey('synthetic'))).toBe('private input'); });
    await clearAccountLocalData();
    expect(mockClearAll).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(bookingDraftKey('synthetic'))).toBeNull();
    expect(sessionStorage.getItem('other-feature')).toBe('keep');
    expect(sessionStorage.getItem(`${CLIENT_BOOKING_DRAFT_META_PREFIX}synthetic`)).toBeNull();
  });
  it('durable cleanup failure still wipes booking drafts and rejects before any caller can claim success', async () => {
    sessionStorage.setItem(bookingDraftKey('synthetic'), 'private input'); mockClearAll.mockRejectedValue(new Error('private provider detail'));
    await expect(clearAccountLocalData()).rejects.toThrow(LOCAL_DATA_CLEAR_FAILED);
    expect(sessionStorage.getItem(bookingDraftKey('synthetic'))).toBeNull();
  });
  it('unconfirmed removal never becomes a successful wipe', async () => {
    sessionStorage.setItem(bookingDraftKey('synthetic'), 'private input'); jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => undefined);
    await expect(clearAccountLocalData()).rejects.toThrow(LOCAL_DATA_CLEAR_FAILED);
  });
  it('unreadable storage entries fail closed', async () => {
    sessionStorage.setItem(bookingDraftKey('synthetic'), 'private input'); jest.spyOn(Storage.prototype, 'key').mockReturnValue(null);
    await expect(clearAccountLocalData()).rejects.toThrow(LOCAL_DATA_CLEAR_FAILED);
  });
  it('unavailable session storage does not claim success from legacy swallowed exceptions', async () => {
    jest.spyOn(Storage.prototype, 'length', 'get').mockImplementation(() => { throw new Error('SecurityError'); });
    await expect(clearAccountLocalData()).rejects.toThrow(LOCAL_DATA_CLEAR_FAILED);
  });
  it('unknown readback is a failure even after a removal appeared successful', async () => {
    sessionStorage.setItem(bookingDraftKey('synthetic'), 'private input'); jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unreadable'); });
    await expect(clearAccountLocalData()).rejects.toThrow(LOCAL_DATA_CLEAR_FAILED);
  });
  it('global boot/header concurrent cleanup shares one operation and can retry after completion', async () => {
    let release!: () => void; mockClearAll.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const first = clearAccountLocalData(); const second = clearAccountLocalData(); expect(first).toBe(second);
    await Promise.resolve(); await Promise.resolve(); release(); await Promise.all([first, second]);
    expect(mockClearAll).toHaveBeenCalledTimes(1); await clearAccountLocalData(); expect(mockClearAll).toHaveBeenCalledTimes(2);
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

describe('B6-13: 退会時に閲覧の履歴（検索語・最近見た施設）も消す', () => {
  beforeEach(() => { jest.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); mockClearAll.mockReset().mockResolvedValue(undefined); });
  it('clearAccountLocalData で検索履歴・閲覧履歴が消え、他のキーは残る', async () => {
    localStorage.setItem('carelink_search_history', '["腰痛"]');
    localStorage.setItem('viewed_facilities', '[{"id":"x"}]');
    localStorage.setItem('cookie-consent', 'kept');
    await clearAccountLocalData();
    expect(localStorage.getItem('carelink_search_history')).toBeNull();
    expect(localStorage.getItem('viewed_facilities')).toBeNull();
    expect(localStorage.getItem('cookie-consent')).toBe('kept');
  });
  it('localStorage が使えなくても退会の後始末は失敗にしない', async () => {
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, _key: string) {
      if (this === localStorage) throw new Error('blocked');
      return undefined as unknown as void;
    });
    await expect(clearAccountLocalData()).resolves.toBeUndefined();
  });
});
