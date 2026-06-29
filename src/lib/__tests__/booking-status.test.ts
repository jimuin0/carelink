import {
  BOOKING_STATUS_LABEL,
  BOOKING_STATUS_HUE,
  bookingStatusLabel,
  bookingStatusHue,
  statusChipClass,
  statusGanttClass,
  statusSolidClass,
  statusBannerClass,
  ALLOWED_STATUS_TRANSITIONS,
  getAllowedStatusTransitions,
  BOOKING_STATUSES,
  SLOT_OCCUPYING_STATUSES,
  SLOT_RELEASING_STATUSES,
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

describe('予約ステータス値集合 SSOT（BOOKING_STATUSES）', () => {
  it('正準集合は DB CHECK 制約と一致する全7値（重複定義のドリフト防止の固定）', () => {
    expect([...BOOKING_STATUSES].sort()).toEqual(
      ['arrived', 'cancel_fee_paid', 'cancelled', 'completed', 'confirmed', 'no_show', 'pending'].sort(),
    );
  });
  it('canon ラベルの全キーを過不足なく含む', () => {
    expect([...BOOKING_STATUSES].sort()).toEqual([...ALL_STATUSES].sort());
  });
});

describe('予約枠 占有/解放 集合 SSOT（SLOT_OCCUPYING_STATUSES / SLOT_RELEASING_STATUSES）', () => {
  it('解放集合は cancelled / no_show / cancel_fee_paid（RPCのNOT IN条件と一致）', () => {
    expect([...SLOT_RELEASING_STATUSES].sort()).toEqual(['cancel_fee_paid', 'cancelled', 'no_show'].sort());
  });
  it('占有集合は pending / confirmed / arrived / completed（解放集合の補集合）', () => {
    expect([...SLOT_OCCUPYING_STATUSES].sort()).toEqual(['arrived', 'completed', 'confirmed', 'pending'].sort());
  });
  it('占有集合と解放集合は重なりなく全7値を分割する', () => {
    const union = [...SLOT_OCCUPYING_STATUSES, ...SLOT_RELEASING_STATUSES].sort();
    expect(union).toEqual([...BOOKING_STATUSES].sort());
    for (const s of SLOT_OCCUPYING_STATUSES) expect(SLOT_RELEASING_STATUSES).not.toContain(s);
  });
});

describe('ステータス遷移 SSOT（ALLOWED_STATUS_TRANSITIONS / getAllowedStatusTransitions）', () => {
  it('全ステータスに遷移先定義が存在する', () => {
    for (const s of ALL_STATUSES) {
      expect(ALLOWED_STATUS_TRANSITIONS[s]).toBeDefined();
    }
  });

  it('既知ステータスは定義済みの遷移先配列を返す（?? 左辺）', () => {
    expect(getAllowedStatusTransitions('confirmed')).toEqual(['arrived', 'completed', 'cancelled', 'no_show']);
    expect(getAllowedStatusTransitions('pending')).toEqual(['confirmed', 'cancelled']);
    expect(getAllowedStatusTransitions('completed')).toEqual(['no_show']);
    expect(getAllowedStatusTransitions('no_show')).toEqual(['cancelled']);
  });

  it('終端ステータス（cancelled / cancel_fee_paid）は遷移先ゼロ', () => {
    expect(getAllowedStatusTransitions('cancelled')).toEqual([]);
    expect(getAllowedStatusTransitions('cancel_fee_paid')).toEqual([]);
  });

  it('未知ステータスは空配列を返す（?? 右辺フォールバック）', () => {
    expect(getAllowedStatusTransitions('???')).toEqual([]);
    expect(getAllowedStatusTransitions('')).toEqual([]);
  });

  // 死にボタンの構造排除を不変条件として固定する：pending と cancel_fee_paid は
  // どの状態の遷移先にも現れない（＝予約詳細のボタンに出ない）。UI が常に 400 になる
  // ボタンを出していた退行（#313/#314）の再発防止。
  it('pending / cancel_fee_paid はどの状態からも遷移先に現れない（死にボタン不在の不変条件）', () => {
    for (const s of ALL_STATUSES) {
      const targets = ALLOWED_STATUS_TRANSITIONS[s];
      expect(targets).not.toContain('pending');
      expect(targets).not.toContain('cancel_fee_paid');
    }
  });

  it('遷移先に自分自身は含まれない（同一ステータスは「既にそのステータス」で別途弾く）', () => {
    for (const s of ALL_STATUSES) {
      expect(ALLOWED_STATUS_TRANSITIONS[s]).not.toContain(s);
    }
  });
});
