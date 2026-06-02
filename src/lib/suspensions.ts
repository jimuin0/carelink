// ネット予約の時間帯停止（#03/#09/#10）の判定ヘルパー。
// 空き表示(slots/availability)と予約確定(booking)の双方で停止範囲を除外するため共通化する。

export interface SuspensionRange {
  start_time: string; // 'HH:MM' or 'HH:MM:SS'
  end_time: string;
}

// 'HH:MM[:SS]' を分に変換
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':');
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
}

// 区間 [aStart, aEnd) と [bStart, bEnd) が重なるか（端点接触は重ならない）
export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

// 指定の予約区間 [start, end) が停止範囲のいずれかと重なるか
export function isRangeSuspended(start: string, end: string, suspensions: SuspensionRange[]): boolean {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  return suspensions.some((sp) => rangesOverlap(s, e, timeToMinutes(sp.start_time), timeToMinutes(sp.end_time)));
}
