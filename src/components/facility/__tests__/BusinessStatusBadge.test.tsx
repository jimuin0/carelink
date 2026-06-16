/**
 * @jest-environment node
 *
 * computeBusinessStatus（純粋関数・TZ非依存）の判定テスト。
 * 深夜営業（close<=open の翌日跨ぎ）が常に 'closed' になっていた不具合の回帰防止を含む。
 */
import { computeBusinessStatus } from '@/components/facility/BusinessStatusBadge';

describe('computeBusinessStatus', () => {
  const day = { open: '09:00', close: '18:00' };

  test('通常営業: 営業時間内 → open', () => {
    expect(computeBusinessStatus('12:00', day)).toBe('open');
  });
  test('通常営業: 開店前 → closed', () => {
    expect(computeBusinessStatus('08:00', day)).toBe('closed');
  });
  test('通常営業: 開店ちょうど → open（>= open）', () => {
    expect(computeBusinessStatus('09:00', day)).toBe('open');
  });
  test('通常営業: 閉店ちょうど → closed（< close 排他）', () => {
    expect(computeBusinessStatus('18:00', day)).toBe('closed');
  });

  const overnight = { open: '20:00', close: '02:00' }; // 翌日跨ぎ

  test('深夜営業: 夜（開店後）→ open（旧コードは closed・回帰防止）', () => {
    expect(computeBusinessStatus('21:00', overnight)).toBe('open');
  });
  test('深夜営業: 翌朝（閉店前）→ open（旧コードは closed・回帰防止）', () => {
    expect(computeBusinessStatus('01:00', overnight)).toBe('open');
  });
  test('深夜営業: 営業時間外（昼）→ closed', () => {
    expect(computeBusinessStatus('15:00', overnight)).toBe('closed');
  });
  test('深夜営業: 閉店ちょうど → closed', () => {
    expect(computeBusinessStatus('02:00', overnight)).toBe('closed');
  });
  test('深夜営業: 開店ちょうど → open', () => {
    expect(computeBusinessStatus('20:00', overnight)).toBe('open');
  });

  test('定休日: todayHours が null → holiday', () => {
    expect(computeBusinessStatus('12:00', null)).toBe('holiday');
  });
  test('定休日: todayHours が undefined → holiday', () => {
    expect(computeBusinessStatus('12:00', undefined)).toBe('holiday');
  });
});
