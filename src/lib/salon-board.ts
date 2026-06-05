/**
 * SALON BOARD（店舗予約管理タイムライン）の純粋関数群。
 *
 * 副作用なし・外部依存なしに統一し、Jest でブランチカバレッジ 100% を維持する。
 * UI（座標計算・レーン配置・時刻変換）と API（時刻・所要時間計算）の双方から利用する。
 */

/** 営業開始時（時）。タイムラインの左端。 */
export const SALON_OPEN_HOUR = 9;
/** 営業終了時（時）。タイムラインの右端。 */
export const SALON_CLOSE_HOUR = 22;
/** 予約の最小刻み（分）。 */
export const SLOT_MINUTES = 15;
/** タイムライングリッドの刻み（分）。SALON BOARD と同じ 30 分。 */
export const GRID_MINUTES = 30;

/** "HH:MM" / "HH:MM:SS" を 0時起点の分に変換。不正値は NaN。 */
export function timeToMinutes(time: string): number {
  const parts = time.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

/** 分（0時起点）を "HH:MM" に変換。負値は 0 に丸める。 */
export function minutesToTime(total: number): string {
  const clamped = Math.max(0, Math.round(total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "HH:MM" に delta 分を加減算した "HH:MM" を返す。 */
export function addMinutes(time: string, delta: number): string {
  return minutesToTime(timeToMinutes(time) + delta);
}

/** 開始時刻 + 所要時間（分）から終了時刻 "HH:MM" を求める。 */
export function computeEndTime(startTime: string, durationMinutes: number): string {
  return addMinutes(startTime, durationMinutes);
}

/** タイムラインに表示する時（hour）の配列。例: [9,10,...,21]。 */
export function hoursRange(openHour = SALON_OPEN_HOUR, closeHour = SALON_CLOSE_HOUR): number[] {
  const out: number[] = [];
  for (let h = openHour; h < closeHour; h++) out.push(h);
  return out;
}

export interface BlockPosition {
  /** タイムライン左端からの位置（%）。 */
  leftPct: number;
  /** ブロック幅（%）。 */
  widthPct: number;
}

/**
 * 予約ブロックの水平位置（左端%・幅%）を求める。
 * 営業時間外にはみ出す分はタイムライン内にクランプする。
 */
export function blockPosition(
  startTime: string,
  endTime: string,
  openHour = SALON_OPEN_HOUR,
  closeHour = SALON_CLOSE_HOUR,
): BlockPosition {
  const openMin = openHour * 60;
  const totalMin = (closeHour - openHour) * 60;
  const startMin = timeToMinutes(startTime) - openMin;
  const endMin = timeToMinutes(endTime) - openMin;
  const clampedStart = Math.max(0, Math.min(startMin, totalMin));
  const clampedEnd = Math.max(0, Math.min(endMin, totalMin));
  const leftPct = (clampedStart / totalMin) * 100;
  const widthPct = Math.max(0, ((clampedEnd - clampedStart) / totalMin) * 100);
  return { leftPct, widthPct };
}

/** 2つの時間範囲（分）が重なるか。端点接触（a.end == b.start）は非重複扱い。 */
export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export interface TimeRangeItem {
  start_time: string;
  end_time: string;
}

export interface RowLayoutItem<T> {
  item: T;
  /** クラスタ内のレーン番号（0 始まり）。 */
  lane: number;
  /** そのクラスタが使用するレーン総数。ブロック高さの分母。 */
  laneCount: number;
}

/**
 * 同一行（スタッフ）内の予約を、重なり合うものを縦に積む（レーン分割）レイアウトに変換する。
 *
 * - 重ならない予約は laneCount=1（全高）。
 * - 重なるクラスタ内では貪欲法で最小レーン数に割り当て、クラスタ内の全予約に同じ laneCount を与える。
 */
export function layoutRow<T extends TimeRangeItem>(items: T[]): RowLayoutItem<T>[] {
  const sorted = [...items].sort((a, b) => {
    const sa = timeToMinutes(a.start_time);
    const sb = timeToMinutes(b.start_time);
    if (sa !== sb) return sa - sb;
    return timeToMinutes(a.end_time) - timeToMinutes(b.end_time);
  });

  const out: RowLayoutItem<T>[] = [];
  let cluster: { item: T; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const laneCount = laneEnds.length;
    for (const c of cluster) out.push({ item: c.item, lane: c.lane, laneCount });
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    const start = timeToMinutes(item.start_time);
    const end = timeToMinutes(item.end_time);
    // 現クラスタと重ならない（start が全予約の終端以降）なら確定して新クラスタへ
    if (cluster.length > 0 && start >= clusterEnd) flush();

    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    cluster.push({ item, lane });
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (cluster.length > 0) flush();
  return out;
}

/**
 * タイムライン上のクリック位置（offsetX）を、刻み（SLOT_MINUTES）に丸めた開始時刻 "HH:MM" に変換する。
 * 営業終了の 1 刻み前を上限とする。
 */
export function offsetToTime(
  offsetX: number,
  width: number,
  openHour = SALON_OPEN_HOUR,
  closeHour = SALON_CLOSE_HOUR,
  snapMin = SLOT_MINUTES,
): string {
  const totalMin = (closeHour - openHour) * 60;
  const ratio = width <= 0 ? 0 : Math.max(0, Math.min(offsetX / width, 1));
  const rawMin = openHour * 60 + ratio * totalMin;
  const snapped = Math.round(rawMin / snapMin) * snapMin;
  const maxStart = closeHour * 60 - snapMin;
  return minutesToTime(Math.min(snapped, maxStart));
}

/**
 * 現在時刻ライン（赤線）の左端位置（%）。営業時間外なら null（非表示）。
 * @param nowMinutes 0 時起点の現在時刻（分）。
 */
export function nowLinePosition(
  nowMinutes: number,
  openHour = SALON_OPEN_HOUR,
  closeHour = SALON_CLOSE_HOUR,
): number | null {
  const openMin = openHour * 60;
  const closeMin = closeHour * 60;
  if (nowMinutes < openMin || nowMinutes > closeMin) return null;
  const totalMin = closeMin - openMin;
  return ((nowMinutes - openMin) / totalMin) * 100;
}

const JP_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * "YYYY-MM-DD" を "YYYY年M月D日（曜）" に整形。不正値は元文字列を返す。
 * 日付（カレンダー値）のみを扱うため UTC 正午基準で解釈し、タイムゾーンずれを避ける。
 */
export function formatDateLabel(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr + 'T00:00:00Z');
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${JP_WEEKDAYS[d.getUTCDay()]}）`;
}

/**
 * 営業時間内の空き枠数（受付可能数）を求める。
 * 全枠数（(close-open)*60/slot）から、予約と重なる枠を除いた数。
 */
export function availableSlotCount(
  items: TimeRangeItem[],
  openHour = SALON_OPEN_HOUR,
  closeHour = SALON_CLOSE_HOUR,
  slotMin = GRID_MINUTES,
): number {
  const openMin = openHour * 60;
  const closeMin = closeHour * 60;
  const total = Math.floor((closeMin - openMin) / slotMin);
  let free = 0;
  for (let i = 0; i < total; i++) {
    const slotStart = openMin + i * slotMin;
    const slotEnd = slotStart + slotMin;
    const occupied = items.some((it) =>
      rangesOverlap(timeToMinutes(it.start_time), timeToMinutes(it.end_time), slotStart, slotEnd),
    );
    if (!occupied) free++;
  }
  return free;
}

/** "YYYY-MM-DD" に日数を加減算した "YYYY-MM-DD"。UTC 基準で計算しタイムゾーンずれを避ける。 */
export function shiftDate(dateStr: string, deltaDays: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
