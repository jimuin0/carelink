/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
/**
 * お客様向け予約メールの「予約の確かめ方」の出し分け（2026年10月23日）。
 *
 * ゲスト予約（ログインせずに予約＝bookings.user_id が NULL）は /mypage に表示されない（マイページは user_id で絞る）。
 * 以前は全員に「予約を確認する」→ /mypage を出しており、ゲストは押しても予約を見つけられなかった。
 * 時間調整のお願いも、ゲストに「マイページの予約変更」と「予約を変更する」ボタンを出していた。
 */
import {
  buildBookingConfirmationEnvelope, buildBookingConfirmedEnvelope, buildBookingRescheduledEnvelope,
  buildBookingReminderContent, buildBookingStatusUpdateEnvelope, buildTimeAdjustRequestEnvelope,
  buildReviewRequestEnvelope, type BookingEmailData,
} from '../email';

const base: BookingEmailData = {
  customerName: '合成 太郎', customerEmail: 'synthetic@example.invalid', facilityName: '合成<サロン>',
  bookingDate: '2030-01-07', startTime: '10:00', endTime: '11:00', bookingId: 'synthetic-booking',
};
const shop = { facilityPhone: '03-1234-5678', facilitySlug: 'synthetic-shop' };

const builders: [string, (d: BookingEmailData) => string][] = [
  ['受付', (d) => buildBookingConfirmationEnvelope(d).html],
  ['確定', (d) => buildBookingConfirmedEnvelope(d).html],
  ['日時変更', (d) => buildBookingRescheduledEnvelope(d).html],
  ['リマインド', (d) => buildBookingReminderContent(d, 1).html],
  ['ステータス変更', (d) => buildBookingStatusUpdateEnvelope({ ...d, newStatus: 'confirmed' }).html],
];

describe.each(builders)('%sメール', (_label, html) => {
  test('会員の予約はマイページへ案内する（店舗の連絡先は出さない）', () => {
    const out = html({ ...base, ...shop, hasAccount: true });
    expect(out).toContain('/mypage');
    expect(out).not.toContain('/facility/synthetic-shop');
    expect(out).not.toContain('直接ご連絡ください');
  });

  test('ゲスト予約はマイページへ案内せず、店舗の電話番号と店舗ページを出す（店名はエスケープ）', () => {
    const out = html({ ...base, ...shop, hasAccount: false });
    expect(out).not.toContain('/mypage');
    expect(out).toContain('合成&lt;サロン&gt;へ直接ご連絡ください');
    expect(out).toContain('href="tel:0312345678"');
    expect(out).toContain('03-1234-5678');
    expect(out).toContain('/facility/synthetic-shop');
  });

  test('会員かどうか分からない（古い送信待ちデータ）ときは、どちらにも通じる文面にする', () => {
    const out = html({ ...base });
    expect(out).toContain('ログインしてご予約された方は、マイページでご予約を確認できます');
    expect(out).toContain('ログインせずにご予約された方は、合成&lt;サロン&gt;へ直接ご連絡ください');
    expect(out).toContain('/mypage');
  });
});

test('ゲスト予約で連絡先が無ければ、店名で「直接ご連絡ください」だけを出す（空のリンクを作らない）', () => {
  const out = buildBookingConfirmationEnvelope({ ...base, hasAccount: false, facilityPhone: null, facilitySlug: null }).html;
  expect(out).toContain('直接ご連絡ください');
  expect(out).not.toContain('tel:');
  expect(out).not.toContain('/facility/');
  expect(out).not.toContain('/mypage');
});

test('電話にならない番号はリンクにも本文にも載せない（tel: に任意の文字列を入れない）', () => {
  const out = buildBookingConfirmedEnvelope({ ...base, hasAccount: false, facilityPhone: 'javascript:alert(1)' }).html;
  expect(out).not.toContain('tel:');
  expect(out).not.toContain('javascript:');
});

describe('終わった予約のステータス変更メール（ゲスト）', () => {
  test.each(['completed', 'no_show', 'cancelled', 'cancel_fee_paid'])('%s には「確認・変更・キャンセル」を案内しない', (newStatus) => {
    const out = buildBookingStatusUpdateEnvelope({ ...base, ...shop, hasAccount: false, newStatus }).html;
    expect(out).not.toContain('確認・変更・キャンセル');
    expect(out).toContain('ご不明な点は、合成&lt;サロン&gt;へご連絡ください。');
    // 連絡先は引き続き出す
    expect(out).toContain('href="tel:0312345678"');
    expect(out).toContain('/facility/synthetic-shop');
  });

  test.each(['confirmed', 'arrived'])('まだ変更・キャンセルできる %s には従来の案内を出す', (newStatus) => {
    const out = buildBookingStatusUpdateEnvelope({ ...base, ...shop, hasAccount: false, newStatus }).html;
    expect(out).toContain('ご予約の確認・変更・キャンセルは、合成&lt;サロン&gt;へ直接ご連絡ください。');
    expect(out).not.toContain('ご不明な点は');
  });

  test('会員の完了メールはマイページへの案内のまま（文面の出し分けはゲストだけ）', () => {
    const out = buildBookingStatusUpdateEnvelope({ ...base, ...shop, hasAccount: true, newStatus: 'completed' }).html;
    expect(out).toContain('/mypage');
    expect(out).not.toContain('ご不明な点は');
  });
});

describe('内線つきの電話番号', () => {
  test('「#」以降（内線）はダイヤルする番号に含めない（別の番号に化けさせない）', () => {
    const out = buildBookingConfirmedEnvelope({ ...base, hasAccount: false, facilityPhone: '03-1234-5678 #12' }).html;
    expect(out).toContain('href="tel:0312345678"');
    expect(out).not.toContain('tel:031234567812');
    // 表示は元の文字列のまま（内線番号も読める）
    expect(out).toContain('03-1234-5678 #12');
  });

  test('「#」より前に数字が無ければリンクにせず、番号の表示だけにする', () => {
    const out = buildBookingConfirmedEnvelope({ ...base, hasAccount: false, facilityPhone: '#1234567' }).html;
    expect(out).not.toContain('tel:');
    expect(out).toContain('電話：#1234567');
  });
});

test('店舗ページの slug はエンコードする', () => {
  const out = buildBookingConfirmedEnvelope({ ...base, hasAccount: false, facilitySlug: 'a/"b' }).html;
  expect(out).toContain('/facility/a%2F%22b');
});

describe('時間調整のお願い', () => {
  test('会員の予約はマイページの予約変更を案内する（従来どおり）', () => {
    const out = buildTimeAdjustRequestEnvelope({ ...base, ...shop, hasAccount: true }).html;
    expect(out).toContain('マイページの予約変更');
    expect(out).toContain('予約を変更する');
    expect(out).toContain('/mypage');
  });

  test('ゲスト予約はマイページを案内せず、店舗への連絡をお願いする', () => {
    const out = buildTimeAdjustRequestEnvelope({ ...base, ...shop, hasAccount: false }).html;
    expect(out).not.toContain('マイページ');
    expect(out).not.toContain('予約を変更する');
    expect(out).toContain('合成&lt;サロン&gt;へ直接ご連絡のうえ');
    expect(out).toContain('href="tel:0312345678"');
    expect(out).toContain('/facility/synthetic-shop');
  });

  test('会員かどうか分からないときは、店舗への連絡を主にし、マイページは会員向けの補足にとどめる', () => {
    const out = buildTimeAdjustRequestEnvelope({ ...base }).html;
    expect(out).toContain('合成&lt;サロン&gt;へのご連絡にて');
    expect(out).toContain('ログインしてご予約された方は、マイページから予約を変更することもできます');
    expect(out).not.toContain('予約を変更する</a>');
  });
});

describe('口コミ依頼メールのポイント案内', () => {
  const review = { email: 'synthetic@example.invalid', customerName: '合成', facilityName: '合成サロン', facilitySlug: 'synthetic-shop' };

  test('会員の予約には、ログインして初めての口コミに付くことを添えて案内する', () => {
    const out = buildReviewRequestEnvelope({ ...review, userId: '33333333-3333-4333-8333-333333333333' }).html;
    expect(out).toContain('50ポイント');
    expect(out).toContain('ログインして投稿');
    expect(out).toContain('初めての口コミ');
  });

  test.each([null, undefined])('ゲスト予約・不明（userId=%p）にはポイントを約束しない', (userId) => {
    const out = buildReviewRequestEnvelope({ ...review, userId }).html;
    expect(out).not.toContain('ポイント');
    expect(out).toContain('口コミを書く');
  });
});
