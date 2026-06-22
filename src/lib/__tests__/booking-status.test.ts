import {
  BOOKING_STATUS_LABEL,
  BOOKING_STATUS_HUE,
  bookingStatusLabel,
  bookingStatusHue,
  statusChipClass,
  statusGanttClass,
  statusSolidClass,
  statusBannerClass,
  type BookingStatus,
} from '@/lib/booking-status';

const ALL_STATUSES: BookingStatus[] = [
  'pending',
  'confirmed',
  'arrived',
  'completed',
  'cancelled',
  'cancel_fee_paid',
  'no_show',
];

describe('booking-status: canon 定義', () => {
  it('全ステータスに canon ラベルが存在する（フル表記）', () => {
    expect(BOOKING_STATUS_LABEL).toEqual({
      pending: '確認待ち',
      confirmed: '確定',
      arrived: '受付',
      completed: '完了',
      cancelled: 'キャンセル',
      cancel_fee_paid: 'キャンセル料支払済',
      no_show: '無断キャンセル',
    });
  });

  it('全ステータスに canon 色相が存在し、confirmed は sky（顧客予約画面と同じ青）', () => {
    expect(BOOKING_STATUS_HUE).toEqual({
      pending: 'amber',
      confirmed: 'sky',
      arrived: 'emerald',
      completed: 'gray',
      cancelled: 'red',
      cancel_fee_paid: 'orange',
      no_show: 'red',
    });
  });
});

describe('bookingStatusLabel', () => {
  it.each(ALL_STATUSES)('既知ステータス %s は canon ラベルを返す', (s) => {
    expect(bookingStatusLabel(s)).toBe(BOOKING_STATUS_LABEL[s]);
  });

  it('未知ステータスは入力値をそのまま返す（フォールバック分岐）', () => {
    expect(bookingStatusLabel('unknown_status')).toBe('unknown_status');
    expect(bookingStatusLabel('')).toBe('');
  });
});

describe('bookingStatusHue', () => {
  it.each(ALL_STATUSES)('既知ステータス %s は canon 色相を返す', (s) => {
    expect(bookingStatusHue(s)).toBe(BOOKING_STATUS_HUE[s]);
  });

  it('未知ステータスは gray にフォールバックする（フォールバック分岐）', () => {
    expect(bookingStatusHue('unknown_status')).toBe('gray');
  });
});

describe('文脈別クラス: 既知ステータス', () => {
  it('statusChipClass: confirmed は sky ピル', () => {
    expect(statusChipClass('confirmed')).toBe('bg-sky-100 text-sky-800 border border-sky-300');
  });

  it('statusGanttClass: confirmed は sky 枠線', () => {
    expect(statusGanttClass('confirmed')).toBe('bg-sky-100 border-sky-400 text-sky-900');
  });

  it('statusSolidClass: confirmed は sky 塗りつぶし白文字', () => {
    expect(statusSolidClass('confirmed')).toBe('bg-sky-500 text-white');
  });

  it('statusBannerClass: confirmed は sky バナー（text / bg 分離）', () => {
    expect(statusBannerClass('confirmed')).toEqual({
      text: 'text-sky-700',
      bg: 'bg-sky-50 border-sky-200',
    });
  });

  it.each(ALL_STATUSES)('全文脈関数は %s で非空文字列を返す', (s) => {
    expect(statusChipClass(s)).toMatch(/\S/);
    expect(statusGanttClass(s)).toMatch(/\S/);
    expect(statusSolidClass(s)).toMatch(/\S/);
    const banner = statusBannerClass(s);
    expect(banner.text).toMatch(/\S/);
    expect(banner.bg).toMatch(/\S/);
  });
});

describe('文脈別クラス: 未知ステータスは gray 系にフォールバック', () => {
  it('statusChipClass', () => {
    expect(statusChipClass('???')).toBe('bg-gray-100 text-gray-700 border border-gray-300');
  });
  it('statusGanttClass', () => {
    expect(statusGanttClass('???')).toBe('bg-gray-200 border-gray-400 text-gray-700');
  });
  it('statusSolidClass', () => {
    expect(statusSolidClass('???')).toBe('bg-gray-300 text-gray-600');
  });
  it('statusBannerClass', () => {
    expect(statusBannerClass('???')).toEqual({
      text: 'text-gray-500',
      bg: 'bg-gray-50 border-gray-200',
    });
  });
});
