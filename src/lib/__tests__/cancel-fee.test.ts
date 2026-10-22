import {
  computeCancelFee, hoursUntilBookingStart, hasBookingStarted, isBeforeBookingStart, describeCancelPolicy,
  resolveCancelPolicy, isOnlineCancelAllowed, ONLINE_CANCEL_DISABLED_MESSAGE, CANCEL_POLICY_DEFAULTS, CANCEL_POLICY_NULL_READING,
  CANCEL_RULES, describeCancelFeeEstimate, describeConfirmedCancelFee, CANCEL_FEE_UNKNOWN_MESSAGE,
  BOOKING_STARTED_CONTACT_MESSAGE,
  type CancelPolicy,
} from '@/lib/cancel-fee';

describe('hoursUntilBookingStart', () => {
  it('JST の予約開始と now の差を時間で返す', () => {
    // 2026-04-01 10:00 JST = 2026-04-01 01:00 UTC
    const startUtcMs = Date.UTC(2026, 3, 1, 1, 0, 0);
    const nowMs = startUtcMs - 5 * 3_600_000; // 5時間前
    expect(hoursUntilBookingStart('2026-04-01', '10:00:00', nowMs)).toBeCloseTo(5, 5);
  });

  it('HH:MM 形式（秒なし）も解釈する', () => {
    const startUtcMs = Date.UTC(2026, 3, 1, 1, 0, 0);
    expect(hoursUntilBookingStart('2026-04-01', '10:00', startUtcMs)).toBeCloseTo(0, 5);
  });

  it('解釈不能な日付 → Infinity（無料扱い）', () => {
    expect(hoursUntilBookingStart('not-a-date', '10:00', Date.UTC(2026, 3, 1))).toBe(Infinity);
  });
});

describe('hasBookingStarted', () => {
  // 2026-04-01 10:00 JST = 2026-04-01 01:00 UTC
  const startUtcMs = Date.UTC(2026, 3, 1, 1, 0, 0);

  it('開始1分前は未開始・開始ちょうどは未開始・開始1分後は開始済み（JST 基準）', () => {
    expect(hasBookingStarted('2026-04-01', '10:00:00', startUtcMs - 60_000)).toBe(false);
    expect(hasBookingStarted('2026-04-01', '10:00:00', startUtcMs)).toBe(false);
    expect(hasBookingStarted('2026-04-01', '10:00:00', startUtcMs + 60_000)).toBe(true);
  });

  it('UTC では前日でも JST で当日の開始を過ぎていれば開始済み', () => {
    // 2026-04-01 08:00 JST = 2026-03-31 23:00 UTC。UTC の日付だけ見ると「まだ前日」に見える。
    expect(hasBookingStarted('2026-04-01', '08:00', Date.UTC(2026, 2, 31, 23, 30))).toBe(true);
  });

  it('解釈不能な日時は開始前として扱う（最終判定は DB）', () => {
    expect(hasBookingStarted('not-a-date', '10:00', startUtcMs)).toBe(false);
  });
});

describe('isBeforeBookingStart（完了・無断キャンセル・会計の確定は開始時刻から）', () => {
  const startUtcMs = Date.UTC(2026, 3, 1, 1, 0, 0); // 2026-04-01 10:00 JST

  it('開始1分前は開始前・開始ちょうどからは記録できる（SQL の BOOKING_NOT_STARTED と同じ境界）', () => {
    expect(isBeforeBookingStart('2026-04-01', '10:00:00', startUtcMs - 60_000)).toBe(true);
    expect(isBeforeBookingStart('2026-04-01', '10:00:00', startUtcMs)).toBe(false);
    expect(isBeforeBookingStart('2026-04-01', '10:00:00', startUtcMs + 60_000)).toBe(false);
  });

  it('UTC の日付ではなく JST の開始時刻で判定する', () => {
    // 2026-04-02 08:00 JST = 2026-04-01 23:00 UTC。UTC では「翌日の予約」に見えるが、30分後には開始済み。
    expect(isBeforeBookingStart('2026-04-02', '08:00', Date.UTC(2026, 3, 1, 23, 30))).toBe(false);
    expect(isBeforeBookingStart('2026-04-02', '08:00', Date.UTC(2026, 3, 1, 22, 30))).toBe(true);
  });

  it('解釈不能な日時は開始前として扱う（記録させない側へ倒す）', () => {
    expect(isBeforeBookingStart('not-a-date', '10:00', startUtcMs)).toBe(true);
  });
});

describe('resolveCancelPolicy（キャンセルポリシーの唯一の解釈）', () => {
  it('明示の3ルールをそのまま返す', () => {
    expect(resolveCancelPolicy({ free_cancel_hours: 48, late_cancel_rate: 30, cancel_rule: 'free_window' }))
      .toEqual({ rule: 'free_window', freeHours: 48, rate: 30 });
    expect(resolveCancelPolicy({ free_cancel_hours: 48, late_cancel_rate: 30, cancel_rule: 'always_fee' }))
      .toEqual({ rule: 'always_fee', rate: 30 });
    expect(resolveCancelPolicy({ free_cancel_hours: 48, late_cancel_rate: 30, cancel_rule: 'no_online' }))
      .toEqual({ rule: 'no_online', rate: 30 });
  });

  it('cancel_rule の無い旧い行: 1時間以上は「N時間前まで無料」、0 以下は旧「キャンセル不可」＝期限なし（常にキャンセル料）', () => {
    expect(resolveCancelPolicy({ free_cancel_hours: 24, late_cancel_rate: 50 })).toEqual({ rule: 'free_window', freeHours: 24, rate: 50 });
    expect(resolveCancelPolicy({ free_cancel_hours: 0, late_cancel_rate: 50 })).toEqual({ rule: 'always_fee', rate: 50 });
    expect(resolveCancelPolicy({ free_cancel_hours: 0, late_cancel_rate: 50, cancel_rule: null })).toEqual({ rule: 'always_fee', rate: 50 });
    expect(resolveCancelPolicy({ free_cancel_hours: -1, late_cancel_rate: 50, cancel_rule: 'free_window' })).toEqual({ rule: 'always_fee', rate: 50 });
  });

  // 回帰（レビュー指摘）: 料率 NULL を DB の DEFAULT（50%）で読むと、それまで予約画面で「キャンセル料はかかりません」と
  // 案内して予約を受けたお客様に、デプロイ後のキャンセルで 50% のキャンセル料が通知されてしまう。
  it('列が NULL の行は 24時間前まで無料・キャンセル料 0%（料率は DB の DEFAULT ではなく、お客様に案内してきた意味）で読む', () => {
    expect(resolveCancelPolicy({ free_cancel_hours: null, late_cancel_rate: null }))
      .toEqual({ rule: 'free_window', freeHours: 24, rate: 0 });
    expect(resolveCancelPolicy({ free_cancel_hours: 24, late_cancel_rate: null, cancel_rule: 'always_fee' }))
      .toEqual({ rule: 'always_fee', rate: 0 });
    expect(CANCEL_POLICY_NULL_READING).toEqual({ free_cancel_hours: 24, late_cancel_rate: 0 });
  });

  it('ポリシー未保存の店舗の設定画面の初期値は DB の DEFAULT（24時間・50%・100%）', () => {
    expect(CANCEL_POLICY_DEFAULTS).toEqual({ free_cancel_hours: 24, late_cancel_rate: 50, no_show_rate: 100 });
  });

  it('ルールの集合は DB の CHECK 制約と同じ3つ', () => {
    expect([...CANCEL_RULES]).toEqual(['free_window', 'always_fee', 'no_online']);
  });
});

describe('isOnlineCancelAllowed', () => {
  it('ポリシー未設定の店舗・「N時間前まで無料」・「期限なし」はネットからキャンセルできる', () => {
    expect(isOnlineCancelAllowed(null)).toBe(true);
    expect(isOnlineCancelAllowed(undefined)).toBe(true);
    expect(isOnlineCancelAllowed({ free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'free_window' })).toBe(true);
    expect(isOnlineCancelAllowed({ free_cancel_hours: 0, late_cancel_rate: 50 })).toBe(true);
    expect(isOnlineCancelAllowed({ free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'always_fee' })).toBe(true);
  });

  it('「ネットでのキャンセル不可」だけが false', () => {
    expect(isOnlineCancelAllowed({ free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'no_online' })).toBe(false);
  });
});

describe('computeCancelFee', () => {
  const policy = { free_cancel_hours: 24, late_cancel_rate: 50, no_show_rate: 100 };

  it('policy 不在 → 無料', () => {
    expect(computeCancelFee(null, 5000, 1)).toEqual({ fee: 0, rate: 0, isLate: false });
  });

  it('金額不明/0以下 → 無料', () => {
    expect(computeCancelFee(policy, null, 1)).toEqual({ fee: 0, rate: 0, isLate: false });
    expect(computeCancelFee(policy, 0, 1)).toEqual({ fee: 0, rate: 0, isLate: false });
  });

  it('無料期限内（残り時間 >= free_cancel_hours）→ 無料', () => {
    expect(computeCancelFee(policy, 5000, 24)).toEqual({ fee: 0, rate: 50, isLate: false });
    expect(computeCancelFee(policy, 5000, 48)).toEqual({ fee: 0, rate: 50, isLate: false });
  });

  it('期限超過 → total_price × late_cancel_rate%（四捨五入）', () => {
    expect(computeCancelFee(policy, 5000, 1)).toEqual({ fee: 2500, rate: 50, isLate: true });
    expect(computeCancelFee({ free_cancel_hours: 24, late_cancel_rate: 30 }, 3333, 0)).toEqual({ fee: 1000, rate: 30, isLate: true });
  });

  it('料率0以下 → 無料（期限超過でも）', () => {
    expect(computeCancelFee({ free_cancel_hours: 24, late_cancel_rate: 0 }, 5000, 1)).toEqual({ fee: 0, rate: 0, isLate: false });
  });

  it('料率が NULL → キャンセル料はかからない（予約画面の「キャンセル料はかかりません」と同じ）', () => {
    expect(computeCancelFee({ free_cancel_hours: null, late_cancel_rate: null }, 5000, 30)).toEqual({ fee: 0, rate: 0, isLate: false });
    expect(computeCancelFee({ free_cancel_hours: null, late_cancel_rate: null }, 5000, 1)).toEqual({ fee: 0, rate: 0, isLate: false });
    expect(computeCancelFee({ free_cancel_hours: 0, late_cancel_rate: null }, 5000, 1)).toEqual({ fee: 0, rate: 0, isLate: false });
  });

  it('無料期限だけ NULL → 24時間前まで無料として計算する', () => {
    expect(computeCancelFee({ free_cancel_hours: null, late_cancel_rate: 50 }, 5000, 30)).toEqual({ fee: 0, rate: 50, isLate: false });
    expect(computeCancelFee({ free_cancel_hours: null, late_cancel_rate: 50 }, 5000, 1)).toEqual({ fee: 2500, rate: 50, isLate: true });
  });

  // 回帰（D3/D13）: 旧「キャンセル不可」（free_cancel_hours=0）は予約画面で「キャンセルの場合は50%」と案内していたのに、
  // 計算は `残り時間 >= 0` で常に無料になり、キャンセル後のメールにも料金が出なかった。
  it('旧「キャンセル不可」の行（free_cancel_hours=0・cancel_rule 無し）は開始1時間前のキャンセルでも料金がかかる', () => {
    expect(computeCancelFee({ free_cancel_hours: 0, late_cancel_rate: 50 }, 5000, 1)).toEqual({ fee: 2500, rate: 50, isLate: true });
  });

  it('「期限なし（常にキャンセル料）」は何日前でも料金がかかる', () => {
    const always = { free_cancel_hours: 24, late_cancel_rate: 30, cancel_rule: 'always_fee' as const };
    expect(computeCancelFee(always, 5000, 240)).toEqual({ fee: 1500, rate: 30, isLate: true });
    expect(computeCancelFee(always, 5000, 0)).toEqual({ fee: 1500, rate: 30, isLate: true });
  });

  it('「ネットでのキャンセル不可」はネットからのキャンセル自体が無いので金額を出さない', () => {
    expect(computeCancelFee({ free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'no_online' }, 5000, 1))
      .toEqual({ fee: 0, rate: 50, isLate: false });
  });
});

describe('describeCancelPolicy（2026年7月15日 追加・予約確認画面の表示文言生成）', () => {
  it('無料期限あり・料率ありの通常ケース', () => {
    expect(describeCancelPolicy({ free_cancel_hours: 24, late_cancel_rate: 50 })).toBe(
      '予約日時の24時間前まで無料でキャンセルできます。それ以降のキャンセルは施術料金の50%をキャンセル料として承ります。'
    );
  });

  it('late_cancel_rate <= 0 → キャンセル料なしの文言（無料期限の値に関わらず優先）', () => {
    expect(describeCancelPolicy({ free_cancel_hours: 24, late_cancel_rate: 0 })).toBe('予約後のキャンセル料はかかりません。');
    expect(describeCancelPolicy({ free_cancel_hours: 0, late_cancel_rate: 0, cancel_rule: 'always_fee' })).toBe('予約後のキャンセル料はかかりません。');
  });

  it('期限なし（明示・旧「キャンセル不可」の行）→ いつでもキャンセル料がかかる文言', () => {
    const expected = 'キャンセルの場合は時期にかかわらず、施術料金の100%をキャンセル料として承ります。';
    expect(describeCancelPolicy({ free_cancel_hours: 0, late_cancel_rate: 100 })).toBe(expected);
    expect(describeCancelPolicy({ free_cancel_hours: 24, late_cancel_rate: 100, cancel_rule: 'always_fee' })).toBe(expected);
  });

  it('ネットでのキャンセル不可 → 店舗への連絡を案内する（料率は出さない）', () => {
    expect(describeCancelPolicy({ free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'no_online' })).toBe(ONLINE_CANCEL_DISABLED_MESSAGE);
    expect(ONLINE_CANCEL_DISABLED_MESSAGE).toBe('この店舗ではネットからのキャンセルをお受けしていません。キャンセルをご希望の場合は、店舗へ直接ご連絡ください。');
  });

  it('料率が NULL → キャンセル料なしの文言（2026年10月23日より前から予約画面が出していた案内のまま）', () => {
    expect(describeCancelPolicy({ free_cancel_hours: null, late_cancel_rate: null })).toBe('予約後のキャンセル料はかかりません。');
    expect(describeCancelPolicy({ free_cancel_hours: 0, late_cancel_rate: null })).toBe('予約後のキャンセル料はかかりません。');
  });

  it('無料期限だけ NULL → 24時間前まで無料の文言', () => {
    expect(describeCancelPolicy({ free_cancel_hours: null, late_cancel_rate: 50 })).toBe(
      '予約日時の24時間前まで無料でキャンセルできます。それ以降のキャンセルは施術料金の50%をキャンセル料として承ります。'
    );
  });
});

// 予約画面の案内（describe）と、キャンセル後に通知される金額（compute）が同じ意味であることを、
// あり得る全ての設定の組み合わせで確かめる。どちらか片方だけを直すとここが落ちる。
describe('予約画面の案内とキャンセル料の計算は同じ定義を使う', () => {
  const rules: Array<CancelPolicy['cancel_rule']> = [null, undefined, 'free_window', 'always_fee', 'no_online'];
  const hoursOptions = [null, 0, 12, 24, 48, 72];
  const rates = [null, 0, 30, 50, 100];
  const remaining = [0, 0.5, 1, 11.9, 12, 23.9, 24, 47.9, 48, 71.9, 72, 500];

  for (const cancel_rule of rules) {
    for (const free_cancel_hours of hoursOptions) {
      for (const late_cancel_rate of rates) {
        const policy: CancelPolicy = { free_cancel_hours, late_cancel_rate, cancel_rule };
        it(`rule=${String(cancel_rule)} hours=${String(free_cancel_hours)} rate=${String(late_cancel_rate)}`, () => {
          const text = describeCancelPolicy(policy);
          const fees = remaining.map((h) => computeCancelFee(policy, 10000, h).fee);
          if (text === ONLINE_CANCEL_DISABLED_MESSAGE || text === '予約後のキャンセル料はかかりません。') {
            expect(fees.every((fee) => fee === 0)).toBe(true);
            return;
          }
          const rate = Number(text.match(/施術料金の(\d+)%/)![1]);
          if (text.startsWith('キャンセルの場合は時期にかかわらず')) {
            expect(fees.every((fee) => fee === rate * 100)).toBe(true);
            return;
          }
          const freeHours = Number(text.match(/予約日時の(\d+)時間前まで無料/)![1]);
          remaining.forEach((h, i) => expect(fees[i]).toBe(h >= freeHours ? 0 : rate * 100));
        });
      }
    }
  }
});

// マイページ・LIFF のキャンセル確認は以前、どの店舗でも「キャンセル料が発生する場合があります」の固定文言で、
// 常にキャンセル料がかかる店舗でも、無料期限内でも同じだった。金額はキャンセル後のメールで初めて分かった。
describe('describeCancelFeeEstimate（キャンセル確認で出すキャンセル料の見込み）', () => {
  const always: CancelPolicy = { free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'always_fee' };
  const window24: CancelPolicy = { free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'free_window' };

  it('常にキャンセル料の店舗は、金額と料率を出す（キャンセル API と同じ computeCancelFee の額）', () => {
    const text = describeCancelFeeEstimate(always, 8000, 100);
    expect(text).toBe('いまキャンセルすると、キャンセル料 ¥4,000（施術料金の50%）がかかります。お支払い方法は店舗からご案内します。');
    expect(text).toContain(`¥${computeCancelFee(always, 8000, 100).fee.toLocaleString()}`);
  });

  it('無料期限を過ぎていれば金額を、期限内なら無料と期限を出す', () => {
    expect(describeCancelFeeEstimate(window24, 8000, 23.9)).toContain('キャンセル料 ¥4,000（施術料金の50%）がかかります');
    expect(describeCancelFeeEstimate(window24, 8000, 24))
      .toBe('いまキャンセルする場合、キャンセル料はかかりません（予約日時の24時間前まで無料）。');
  });

  it('料率 0・金額 0・ポリシー未設定は、はっきり無料と出す（期限の案内は付けない）', () => {
    expect(describeCancelFeeEstimate({ ...window24, late_cancel_rate: 0 }, 8000, 100)).toBe('キャンセル料はかかりません。');
    expect(describeCancelFeeEstimate(window24, 0, 1)).toBe('キャンセル料はかかりません。');
    expect(describeCancelFeeEstimate(always, 0, 100)).toBe('キャンセル料はかかりません。');
    expect(describeCancelFeeEstimate(null, 8000, 1)).toBe('キャンセル料はかかりません。');
    // 端数で 0 円になる場合もキャンセル API の額（0）に合わせる。
    expect(describeCancelFeeEstimate({ ...always, late_cancel_rate: 10 }, 4, 100)).toBe('キャンセル料はかかりません。');
  });

  it('ポリシーを読めなかったときは金額を推測しない（従来の一般的な案内）', () => {
    expect(describeCancelFeeEstimate(undefined, 8000, 1)).toBe(CANCEL_FEE_UNKNOWN_MESSAGE);
  });

  it('ネットでのキャンセル不可の店舗は、無料とは言わずに店舗への連絡を案内する', () => {
    expect(describeCancelFeeEstimate({ ...always, cancel_rule: 'no_online' }, 8000, 100)).toBe(ONLINE_CANCEL_DISABLED_MESSAGE);
  });

  // 見込みの金額は、同じ材料で計算したキャンセル API の額と必ず一致する（どちらか片方だけ直すとここが落ちる）。
  it('見込みの金額はあらゆる設定で computeCancelFee と一致する', () => {
    for (const cancel_rule of [null, 'free_window', 'always_fee'] as const) {
      for (const free_cancel_hours of [null, 0, 24, 72]) {
        for (const late_cancel_rate of [null, 0, 30, 100]) {
          for (const hours of [-1, 0, 23.9, 24, 71.9, 72, 500]) {
            const policy: CancelPolicy = { free_cancel_hours, late_cancel_rate, cancel_rule };
            const { fee } = computeCancelFee(policy, 9000, hours);
            const text = describeCancelFeeEstimate(policy, 9000, hours);
            if (fee > 0) expect(text).toContain(`キャンセル料 ¥${fee.toLocaleString()}`);
            else expect(text).toMatch(/キャンセル料はかかりません/);
          }
        }
      }
    }
  });
});

describe('describeConfirmedCancelFee（キャンセル後に、API が返した確定額を出す）', () => {
  it('確定額があれば金額を出す', () => {
    expect(describeConfirmedCancelFee(4000)).toBe('キャンセル料 ¥4,000 が発生します。お支払い方法は店舗からご案内します。');
  });
  it('0 円ははっきり無料と出す', () => {
    expect(describeConfirmedCancelFee(0)).toBe('キャンセル料はかかりません。');
  });
  it.each([undefined, null, '4000', Number.NaN, Number.POSITIVE_INFINITY, -1])('数値として読めない値 %p は出さない（金額を推測しない）', (value) => {
    expect(describeConfirmedCancelFee(value)).toBeNull();
  });
});

describe('BOOKING_STARTED_CONTACT_MESSAGE', () => {
  it('開始後は変更もキャンセルもできず、店舗への連絡を促す', () => {
    expect(BOOKING_STARTED_CONTACT_MESSAGE).toContain('日時の変更やキャンセルができません');
    expect(BOOKING_STARTED_CONTACT_MESSAGE).toContain('店舗へ直接ご連絡ください');
  });
});
