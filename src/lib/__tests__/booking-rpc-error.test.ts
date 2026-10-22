/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { bookingRpcErrorCode, knownBookingRpcMessage } from '@/lib/booking-rpc-error';

describe('bookingRpcErrorCode', () => {
  it('「コード: 説明」形式の RAISE から先頭のコードだけを取り出す', () => {
    expect(bookingRpcErrorCode('BOOKING_CONFLICT: この時間帯は既に予約が入っています')).toBe('BOOKING_CONFLICT');
    expect(bookingRpcErrorCode('STAFF_NOT_WORKING: このスタッフはこの日は勤務していません')).toBe('STAFF_NOT_WORKING');
  });

  it('コードだけの RAISE はそのまま返す', () => {
    expect(bookingRpcErrorCode('POINTS_INSUFFICIENT')).toBe('POINTS_INSUFFICIENT');
    expect(bookingRpcErrorCode(' BOOKING_MENU_UNAVAILABLE ')).toBe('BOOKING_MENU_UNAVAILABLE');
  });

  it.each([undefined, null, 42, {}])('文字列でない message %p は空文字', (message) => {
    expect(bookingRpcErrorCode(message)).toBe('');
  });
});

describe('knownBookingRpcMessage', () => {
  const known = { BOOKING_CONFLICT: 'この時間帯は既に予約が入っています' };

  it('実際の RPC 文言（説明つき）でも既知の拒否として文言を返す（回帰防止: 以前は 500 になっていた）', () => {
    expect(knownBookingRpcMessage('BOOKING_CONFLICT: この時間帯は既に予約が入っています', known)).toBe('この時間帯は既に予約が入っています');
    expect(knownBookingRpcMessage('BOOKING_CONFLICT', known)).toBe('この時間帯は既に予約が入っています');
  });

  it.each(['UNKNOWN_CODE: x', 'toString', 'constructor: x', '__proto__', ''])('表に無いコード %p は undefined（prototype のキーも既知扱いしない）', (message) => {
    expect(knownBookingRpcMessage(message, known)).toBeUndefined();
  });
});
